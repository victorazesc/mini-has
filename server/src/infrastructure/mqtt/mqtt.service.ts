import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Socket, connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface MqttConnectionOptions {
  brokerUrl: string;
  clientId?: string | null;
  username?: string | null;
  password?: string | null;
  connectTimeoutMs?: number;
  keepAliveSeconds?: number;
}

export interface MqttMessage {
  topic: string;
  payload: string;
  retain: boolean;
  qos: number;
}

interface MqttPacket {
  type: number;
  flags: number;
  payload: Buffer;
}

@Injectable()
export class MqttService {
  async testConnection(options: MqttConnectionOptions): Promise<void> {
    const client = new MqttConnection(options);
    try {
      await client.connect();
    } finally {
      client.close();
    }
  }

  async collectMessages(options: MqttConnectionOptions, topic: string, waitMs: number): Promise<MqttMessage[]> {
    const client = new MqttConnection(options);
    const messages: MqttMessage[] = [];
    try {
      await client.connect();
      client.onMessage((message) => messages.push(message));
      await client.subscribe(topic);
      await delay(waitMs);
      return messages;
    } finally {
      client.close();
    }
  }

  async publish(options: MqttConnectionOptions, topic: string, payload: unknown, retain = false): Promise<void> {
    const client = new MqttConnection(options);
    try {
      await client.connect();
      client.publish(topic, payloadToString(payload), retain);
    } finally {
      client.close();
    }
  }
}

class MqttConnection {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private packetId = 1;
  private readonly emitter = new EventEmitter();

  constructor(private readonly options: MqttConnectionOptions) {}

  async connect(): Promise<void> {
    const target = parseBrokerUrl(this.options.brokerUrl);
    const timeoutMs = this.options.connectTimeoutMs || 5_000;
    const socket =
      target.protocol === 'mqtts:'
        ? tlsConnect({ host: target.host, port: target.port, servername: target.host })
        : netConnect({ host: target.host, port: target.port });
    this.socket = socket;
    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk) => this.readPackets(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('error', (error) => this.emitter.emit('socket-error', error));
    socket.on('timeout', () => socket.destroy(new Error('Timeout conectando ao broker MQTT.')));

    await waitForSocketConnect(socket, timeoutMs);
    socket.setTimeout(0);
    this.write(this.connectPacket(target));
    const connack = await this.waitForPacket((packet) => packet.type === 2, timeoutMs);
    if (connack.payload.length < 2 || connack.payload[1] !== 0) {
      throw new Error(`Broker MQTT recusou conexao. Codigo ${connack.payload[1] ?? 'desconhecido'}.`);
    }
  }

  async subscribe(topic: string): Promise<void> {
    const packetId = this.nextPacketId();
    const payload = Buffer.concat([uint16(packetId), utf8(topic), Buffer.from([0])]);
    this.write(packet(0x82, payload));
    await this.waitForPacket((item) => item.type === 9 && item.payload.readUInt16BE(0) === packetId, 5_000);
  }

  publish(topic: string, payload: string, retain = false): void {
    const fixedHeader = retain ? 0x31 : 0x30;
    this.write(packet(fixedHeader, Buffer.concat([utf8(topic), Buffer.from(payload)])));
  }

  onMessage(handler: (message: MqttMessage) => void): void {
    this.emitter.on('message', handler);
  }

  close(): void {
    if (!this.socket) return;
    if (!this.socket.destroyed) {
      try {
        this.write(Buffer.from([0xe0, 0]));
      } catch {
        // Connection is already closing.
      }
      this.socket.end();
    }
    this.socket = null;
  }

  private connectPacket(target: ReturnType<typeof parseBrokerUrl>): Buffer {
    const username = firstNonEmpty(this.options.username, target.username);
    const password = firstNonEmpty(this.options.password, target.password);
    const clientId = firstNonEmpty(this.options.clientId, `mini-has-${Math.random().toString(16).slice(2)}`);
    let flags = 0x02;
    if (username) flags |= 0x80;
    if (password) flags |= 0x40;
    const keepAlive = uint16(this.options.keepAliveSeconds || 30);
    const variableHeader = Buffer.concat([utf8('MQTT'), Buffer.from([4, flags]), keepAlive]);
    const payloadParts = [utf8(clientId)];
    if (username) payloadParts.push(utf8(username));
    if (password) payloadParts.push(utf8(password));
    return packet(0x10, Buffer.concat([variableHeader, ...payloadParts]));
  }

  private nextPacketId(): number {
    const current = this.packetId;
    this.packetId = this.packetId >= 65535 ? 1 : this.packetId + 1;
    return current;
  }

  private write(data: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new Error('Cliente MQTT desconectado.');
    this.socket.write(data);
  }

  private readPackets(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const remaining = decodeRemainingLength(this.buffer, 1);
      if (!remaining) return;
      const totalLength = 1 + remaining.bytes + remaining.value;
      if (this.buffer.length < totalLength) return;
      const fixedHeader = this.buffer[0];
      const payload = this.buffer.subarray(1 + remaining.bytes, totalLength);
      this.buffer = this.buffer.subarray(totalLength);
      const packet = { type: fixedHeader >> 4, flags: fixedHeader & 0x0f, payload };
      if (packet.type === 3) this.emitPublish(packet);
      this.emitter.emit('packet', packet);
    }
  }

  private emitPublish(packet: MqttPacket): void {
    if (packet.payload.length < 2) return;
    const topicLength = packet.payload.readUInt16BE(0);
    const topicEnd = 2 + topicLength;
    if (packet.payload.length < topicEnd) return;
    const qos = (packet.flags >> 1) & 0x03;
    const payloadStart = qos > 0 ? topicEnd + 2 : topicEnd;
    const topic = packet.payload.subarray(2, topicEnd).toString('utf8');
    const payload = packet.payload.subarray(payloadStart).toString('utf8');
    this.emitter.emit('message', { topic, payload, retain: Boolean(packet.flags & 0x01), qos } as MqttMessage);
  }

  private waitForPacket(predicate: (packet: MqttPacket) => boolean, timeoutMs: number): Promise<MqttPacket> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => cleanup(() => reject(new Error('Timeout aguardando resposta MQTT.'))), timeoutMs);
      const onPacket = (packet: MqttPacket) => {
        if (predicate(packet)) cleanup(() => resolve(packet));
      };
      const onError = (error: Error) => cleanup(() => reject(error));
      const cleanup = (done: () => void) => {
        clearTimeout(timeout);
        this.emitter.off('packet', onPacket);
        this.emitter.off('socket-error', onError);
        done();
      };
      this.emitter.on('packet', onPacket);
      this.emitter.on('socket-error', onError);
    });
  }
}

function parseBrokerUrl(value: string) {
  const url = new URL(value);
  if (!['mqtt:', 'mqtts:'].includes(url.protocol)) throw new Error('Broker MQTT precisa usar mqtt:// ou mqtts://.');
  return {
    protocol: url.protocol,
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'mqtts:' ? 8883 : 1883)),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
  };
}

function waitForSocketConnect(socket: Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => cleanup(() => reject(new Error('Timeout conectando ao broker MQTT.'))), timeoutMs);
    const onConnect = () => cleanup(resolve);
    const onError = (error: Error) => cleanup(() => reject(error));
    const cleanup = (done: () => void) => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('secureConnect', onConnect);
      socket.off('error', onError);
      done();
    };
    socket.once('connect', onConnect);
    socket.once('secureConnect', onConnect);
    socket.once('error', onError);
  });
}

function packet(fixedHeader: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([fixedHeader]), encodeRemainingLength(payload.length), payload]);
}

function utf8(value: string): Buffer {
  const content = Buffer.from(value);
  return Buffer.concat([uint16(content.length), content]);
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function encodeRemainingLength(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let encoded = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) encoded |= 128;
    bytes.push(encoded);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function decodeRemainingLength(buffer: Buffer, offset: number): { value: number; bytes: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytes = 0;
  let encoded = 0;
  do {
    if (offset + bytes >= buffer.length) return null;
    encoded = buffer[offset + bytes];
    value += (encoded & 127) * multiplier;
    multiplier *= 128;
    bytes += 1;
    if (bytes > 4) throw new Error('Pacote MQTT invalido.');
  } while ((encoded & 128) !== 0);
  return { value, bytes };
}

function payloadToString(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'object') return JSON.stringify(payload);
  return String(payload);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
