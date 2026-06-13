import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { Socket, createConnection } from 'node:net';
import { JsonObject } from '../../types';

export const DEFAULT_PORT = 6668;
export const DEFAULT_TIMEOUT_MS = 3500;

const CMD_SESS_KEY_NEG_START = 3;
const CMD_SESS_KEY_NEG_RESP = 4;
const CMD_SESS_KEY_NEG_FINISH = 5;
const CMD_CONTROL = 0x07;
const CMD_DP_QUERY = 0x0a;
const CMD_CONTROL_NEW = 0x0d;
const CMD_DP_QUERY_NEW = 0x10;
const PREFIX_55AA = 0x000055aa;
const PREFIX_6699 = 0x00006699;
const SUFFIX_55AA = 0x0000aa55;
const SUFFIX_6699 = 0x00009966;
const HEADER_SIZE = 16;
const HEADER_SIZE_35 = 18;
const RETCODE_SIZE = 4;
const HMAC_SIZE = 32;
const SUFFIX_SIZE = 4;
const VERSION_34_HEADER = Buffer.concat([Buffer.from('3.4'), Buffer.alloc(12)]);
const VERSION_35_HEADER = Buffer.concat([Buffer.from('3.5'), Buffer.alloc(12)]);
const VERSION_33_HEADER = Buffer.concat([Buffer.from('3.3'), Buffer.alloc(12)]);
const LOCAL_NONCE = Buffer.from('0123456789abcdef');

interface ParsedMessage {
  sequence: number;
  command: number;
  retcode: number;
  payload: Buffer;
}

export class TuyaLanClient {
  private readonly realLocalKey: Buffer;
  private currentKey: Buffer;
  private sequenceNumber = 1;
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private socketError?: Error;

  constructor(
    private readonly ip: string,
    private readonly deviceId: string,
    localKey: string,
    private readonly port = DEFAULT_PORT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly version = '3.4',
  ) {
    if (localKey.length !== 16) throw new Error('A local key precisa ter 16 caracteres.');
    if (!['3.3', '3.4', '3.5'].includes(version)) throw new Error(`Versao Tuya LAN ${version} ainda nao suportada.`);
    this.realLocalKey = Buffer.from(localKey);
    this.currentKey = this.realLocalKey;
    this.timeoutMs = timeoutMs;
  }

  private readonly timeoutMs: number;

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.ip, port: this.port, timeout: this.timeoutMs }, resolve);
      socket.setNoDelay(true);
      socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        this.notifyWaiters();
      });
      socket.on('error', (error) => {
        this.socketError = error;
        this.notifyWaiters();
        reject(error);
      });
      socket.on('timeout', () => {
        const error = new Error('A Tuya nao respondeu a tempo.');
        this.socketError = error;
        socket.destroy(error);
        reject(error);
      });
      this.socket = socket;
    });
    if (this.version !== '3.3') await this.negotiateSessionKey();
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }

  async queryStatus(cid?: string | null): Promise<JsonObject> {
    const command = this.version === '3.3' ? CMD_DP_QUERY : CMD_DP_QUERY_NEW;
    const message = await this.sendAndReceiveNonEmpty(this.encodeMessage(this.nextSequence(), command, this.queryPayload(cid)), true);
    return this.decodePayload(message.payload);
  }

  async setDpsValue(dpsId: string, value: unknown, cid?: string | null): Promise<JsonObject> {
    const command = this.version === '3.3' ? CMD_CONTROL : CMD_CONTROL_NEW;
    const message = await this.sendAndReceiveNonEmpty(this.encodeMessage(this.nextSequence(), command, this.controlPayload(dpsId, value, cid)), true);
    if (message.payload.length) {
      try {
        const response = this.decodePayload(message.payload);
        if (response.dps && typeof response.dps === 'object') return response;
      } catch {
        // Query below is the authoritative fallback.
      }
    }
    return this.queryStatus(cid);
  }

  async setDpsValueNowait(dpsId: string, value: unknown, cid?: string | null): Promise<JsonObject> {
    const command = this.version === '3.3' ? CMD_CONTROL : CMD_CONTROL_NEW;
    this.writeMessage(this.encodeMessage(this.nextSequence(), command, this.controlPayload(dpsId, value, cid)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {};
  }

  private async negotiateSessionKey(): Promise<void> {
    const response = await this.sendAndReceiveNonEmpty(this.encodeMessage(this.nextSequence(), CMD_SESS_KEY_NEG_START, LOCAL_NONCE), false);
    if (response.command !== CMD_SESS_KEY_NEG_RESP) throw new Error('Resposta invalida na negociacao da Tuya.');
    const negotiationPayload = this.version === '3.5' ? response.payload : aesDecryptPadded(response.payload, this.realLocalKey);
    if (negotiationPayload.length < 48) throw new Error('Payload curto na negociacao da Tuya.');
    const remoteNonce = negotiationPayload.subarray(0, 16);
    const receivedLocalHmac = negotiationPayload.subarray(16, 48);
    const expectedLocalHmac = createHmac('sha256', this.realLocalKey).update(LOCAL_NONCE).digest();
    if (!safeEqual(expectedLocalHmac, receivedLocalHmac)) throw new Error('Falha ao validar o desafio da Tuya.');

    const finishHmac = createHmac('sha256', this.realLocalKey).update(remoteNonce).digest();
    this.writeMessage(this.encodeMessage(this.nextSequence(), CMD_SESS_KEY_NEG_FINISH, finishHmac));
    const xorNonce = Buffer.from(LOCAL_NONCE.map((value, index) => value ^ remoteNonce[index]));
    this.currentKey = this.version === '3.5'
      ? aesGcmEncryptNoTag(xorNonce, this.realLocalKey, LOCAL_NONCE)
      : aesEncryptNoPad(xorNonce, this.realLocalKey);
  }

  private async sendAndReceiveNonEmpty(message: Buffer, allowEmptyAck: boolean): Promise<ParsedMessage> {
    this.writeMessage(message);
    while (true) {
      const nextMessage = await this.readMessage();
      if (nextMessage.payload.length) return nextMessage;
      if (!allowEmptyAck) return nextMessage;
    }
  }

  private writeMessage(message: Buffer): void {
    if (!this.socket) throw new Error('Socket Tuya nao conectado.');
    this.socket.write(message);
  }

  private async readMessage(): Promise<ParsedMessage> {
    if (this.version === '3.5') return this.readMessage35();
    if (this.version === '3.3') return this.readMessage33();

    const headerBytes = await this.readFully(HEADER_SIZE);
    const prefix = headerBytes.readUInt32BE(0);
    const sequence = headerBytes.readUInt32BE(4);
    const command = headerBytes.readUInt32BE(8);
    const length = headerBytes.readUInt32BE(12);
    if (prefix !== PREFIX_55AA) throw new Error('Prefixo Tuya inesperado.');

    const body = await this.readFully(length);
    if (length < RETCODE_SIZE + HMAC_SIZE + SUFFIX_SIZE) throw new Error('Resposta Tuya invalida.');
    const retcode = body.readUInt32BE(0);
    const payloadLength = length - RETCODE_SIZE - HMAC_SIZE - SUFFIX_SIZE;
    if (payloadLength < 0) throw new Error('Payload Tuya corrompido.');

    const payloadEnd = RETCODE_SIZE + payloadLength;
    const encryptedPayload = body.subarray(RETCODE_SIZE, payloadEnd);
    const messageHmac = body.subarray(payloadEnd, payloadEnd + HMAC_SIZE);
    const suffix = body.readUInt32BE(payloadEnd + HMAC_SIZE);
    if (suffix !== SUFFIX_55AA) throw new Error('Sufixo Tuya invalido.');

    const hmacSource = Buffer.concat([headerBytes, body.subarray(0, payloadEnd)]);
    const expectedHmac = createHmac('sha256', this.currentKey).update(hmacSource).digest();
    if (!safeEqual(expectedHmac, messageHmac)) throw new Error('Falha ao validar HMAC da Tuya.');
    return { sequence, command, retcode, payload: encryptedPayload };
  }

  private async readMessage33(): Promise<ParsedMessage> {
    const headerBytes = await this.readFully(HEADER_SIZE);
    const prefix = headerBytes.readUInt32BE(0);
    const sequence = headerBytes.readUInt32BE(4);
    const command = headerBytes.readUInt32BE(8);
    const length = headerBytes.readUInt32BE(12);
    if (prefix !== PREFIX_55AA || length < RETCODE_SIZE + 8) throw new Error('Resposta Tuya 3.3 invalida.');
    const body = await this.readFully(length);
    const suffix = body.readUInt32BE(body.length - SUFFIX_SIZE);
    if (suffix !== SUFFIX_55AA) throw new Error('Sufixo Tuya 3.3 invalido.');
    const payloadEnd = body.length - 8;
    const expectedCrc = body.readUInt32BE(payloadEnd);
    const actualCrc = crc32(Buffer.concat([headerBytes, body.subarray(0, payloadEnd)]));
    if (expectedCrc !== actualCrc) throw new Error('CRC Tuya 3.3 invalido.');
    return { sequence, command, retcode: body.readUInt32BE(0), payload: body.subarray(RETCODE_SIZE, payloadEnd) };
  }

  private async readMessage35(): Promise<ParsedMessage> {
    const headerBytes = await this.readFully(HEADER_SIZE_35);
    const prefix = headerBytes.readUInt32BE(0);
    const sequence = headerBytes.readUInt32BE(6);
    const command = headerBytes.readUInt32BE(10);
    const length = headerBytes.readUInt32BE(14);
    if (prefix !== PREFIX_6699 || length < 28) throw new Error('Resposta Tuya 3.5 invalida.');

    const body = await this.readFully(length + SUFFIX_SIZE);
    const suffix = body.readUInt32BE(body.length - SUFFIX_SIZE);
    if (suffix !== SUFFIX_6699) throw new Error('Sufixo Tuya 3.5 invalido.');

    const iv = body.subarray(0, 12);
    const tagStart = body.length - SUFFIX_SIZE - 16;
    const encryptedPayload = body.subarray(12, tagStart);
    const tag = body.subarray(tagStart, body.length - SUFFIX_SIZE);
    const plainPayload = aesGcmDecrypt(encryptedPayload, this.currentKey, iv, headerBytes.subarray(4), tag);
    if (plainPayload.length < RETCODE_SIZE) throw new Error('Payload Tuya 3.5 invalido.');
    return {
      sequence,
      command,
      retcode: plainPayload.readUInt32BE(0),
      payload: plainPayload.subarray(RETCODE_SIZE),
    };
  }

  private encodeMessage(sequence: number, command: number, jsonPayload: Buffer): Buffer {
    if (this.version === '3.5') return this.encodeMessage35(sequence, command, jsonPayload);
    if (this.version === '3.3') return this.encodeMessage33(sequence, command, jsonPayload);

    const payload = skipsVersionHeader(command) ? jsonPayload : Buffer.concat([VERSION_34_HEADER, jsonPayload]);
    const encryptedPayload = aesEncryptPadded(payload, this.currentKey);
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(PREFIX_55AA, 0);
    header.writeUInt32BE(sequence, 4);
    header.writeUInt32BE(command, 8);
    header.writeUInt32BE(encryptedPayload.length + HMAC_SIZE + SUFFIX_SIZE, 12);
    const unsignedMessage = Buffer.concat([header, encryptedPayload]);
    const messageHmac = createHmac('sha256', this.currentKey).update(unsignedMessage).digest();
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE(SUFFIX_55AA, 0);
    return Buffer.concat([unsignedMessage, messageHmac, suffix]);
  }

  private encodeMessage33(sequence: number, command: number, jsonPayload: Buffer): Buffer {
    const payload = command === CMD_CONTROL
      ? Buffer.concat([VERSION_33_HEADER, aesEncryptPadded(jsonPayload, this.realLocalKey)])
      : jsonPayload;
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(PREFIX_55AA, 0);
    header.writeUInt32BE(sequence, 4);
    header.writeUInt32BE(command, 8);
    header.writeUInt32BE(payload.length + 8, 12);
    const unsignedMessage = Buffer.concat([header, payload]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(unsignedMessage), 0);
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE(SUFFIX_55AA, 0);
    return Buffer.concat([unsignedMessage, crc, suffix]);
  }

  private encodeMessage35(sequence: number, command: number, jsonPayload: Buffer): Buffer {
    const payload = skipsVersionHeader(command) ? jsonPayload : Buffer.concat([VERSION_35_HEADER, jsonPayload]);
    const header = Buffer.alloc(HEADER_SIZE_35);
    header.writeUInt32BE(PREFIX_6699, 0);
    header.writeUInt16BE(0, 4);
    header.writeUInt32BE(sequence, 6);
    header.writeUInt32BE(command, 10);
    header.writeUInt32BE(payload.length + 28, 14);
    const iv = Buffer.from((Date.now() * 10).toString().slice(0, 12));
    const encrypted = aesGcmEncrypt(payload, this.currentKey, iv, header.subarray(4));
    const suffix = Buffer.alloc(SUFFIX_SIZE);
    suffix.writeUInt32BE(SUFFIX_6699, 0);
    return Buffer.concat([header, iv, encrypted.payload, encrypted.tag, suffix]);
  }

  private decodePayload(payload: Buffer): JsonObject {
    if (!payload.length) return {};
    let plainPayload = payload;
    if (this.version === '3.3') {
      if (plainPayload.subarray(0, VERSION_33_HEADER.length).equals(VERSION_33_HEADER)) {
        plainPayload = plainPayload.subarray(VERSION_33_HEADER.length);
      }
      try {
        plainPayload = aesDecryptPadded(plainPayload, this.realLocalKey);
      } catch {
        // Some 3.3 responses are plain JSON.
      }
    } else if (this.version !== '3.5') {
      plainPayload = aesDecryptPadded(payload, this.currentKey);
    }
    const versionHeader = this.version === '3.5' ? VERSION_35_HEADER : this.version === '3.3' ? VERSION_33_HEADER : VERSION_34_HEADER;
    if (plainPayload.subarray(0, versionHeader.length).equals(versionHeader)) {
      plainPayload = plainPayload.subarray(versionHeader.length);
    }
    const jsonString = plainPayload.toString('utf8').replace(/\0+$/g, '').trim();
    let decoded: JsonObject;
    try {
      decoded = JSON.parse(jsonString);
    } catch {
      try {
        decoded = JSON.parse(recoverJsonObject(jsonString));
      } catch {
        return {};
      }
    }
    if (!decoded.dps && decoded.data && typeof decoded.data === 'object' && decoded.data.dps && typeof decoded.data.dps === 'object') {
      decoded.dps = decoded.data.dps;
    }
    return decoded;
  }

  private async readFully(length: number): Promise<Buffer> {
    const deadline = Date.now() + this.timeoutMs;
    while (this.buffer.length < length) {
      if (this.socketError) throw this.socketError;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('A Tuya nao respondeu a tempo.');
      await this.waitForData(remaining);
    }
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return result;
  }

  private waitForData(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== onData);
        reject(new Error('A Tuya nao respondeu a tempo.'));
      }, timeoutMs);
      const onData = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.waiters.push(onData);
    });
  }

  private notifyWaiters(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private nextSequence(): number {
    return this.sequenceNumber++;
  }

  private queryPayload(cid?: string | null): Buffer {
    if (this.version !== '3.3') return jsonBytes(cid ? { cid } : {});
    const request: JsonObject = {
      gwId: this.deviceId,
      devId: cid || this.deviceId,
      uid: cid || this.deviceId,
      t: Math.floor(Date.now() / 1000),
    };
    if (cid) request.cid = cid;
    return jsonBytes(request);
  }

  private controlPayload(dpsId: string, value: unknown, cid?: string | null): Buffer {
    if (this.version === '3.3') {
      const request: JsonObject = {
        devId: cid || this.deviceId,
        uid: cid || this.deviceId,
        t: Math.floor(Date.now() / 1000),
        dps: { [dpsId]: value },
      };
      if (cid) request.cid = cid;
      return jsonBytes(request);
    }
    const data: JsonObject = { dps: { [dpsId]: value } };
    const request: JsonObject = {};
    if (cid) {
      data.cid = cid;
      data.ctype = 0;
      request.cid = cid;
    }
    request.protocol = 5;
    request.t = Math.floor(Date.now() / 1000);
    request.data = data;
    return jsonBytes(request);
  }
}

function jsonBytes(value: JsonObject): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function skipsVersionHeader(command: number): boolean {
  return [CMD_DP_QUERY_NEW, CMD_SESS_KEY_NEG_START, CMD_SESS_KEY_NEG_RESP, CMD_SESS_KEY_NEG_FINISH].includes(command);
}

function recoverJsonObject(value: string): string {
  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return value.slice(firstBrace, lastBrace + 1);
  if (value.includes(':')) return `{${value.replace(/[{}]/g, '')}}`;
  throw new Error('Payload Tuya nao contem JSON valido.');
}

function aesEncryptPadded(payload: Buffer, key: Buffer): Buffer {
  return aes(payload, key, false, true);
}

function aesDecryptPadded(payload: Buffer, key: Buffer): Buffer {
  return aes(payload, key, true, true);
}

function aesEncryptNoPad(payload: Buffer, key: Buffer): Buffer {
  return aes(payload, key, false, false);
}

function aesGcmEncrypt(payload: Buffer, key: Buffer, iv: Buffer, aad?: Buffer): { payload: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-128-gcm', key, iv.subarray(0, 12));
  if (aad) cipher.setAAD(aad);
  return {
    payload: Buffer.concat([cipher.update(payload), cipher.final()]),
    tag: cipher.getAuthTag(),
  };
}

function aesGcmEncryptNoTag(payload: Buffer, key: Buffer, iv: Buffer): Buffer {
  return aesGcmEncrypt(payload, key, iv).payload;
}

function aesGcmDecrypt(payload: Buffer, key: Buffer, iv: Buffer, aad: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-gcm', key, iv.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]);
}

function aes(payload: Buffer, key: Buffer, decrypt: boolean, padded: boolean): Buffer {
  const cipher = decrypt ? createDecipheriv('aes-128-ecb', key, null) : createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(padded);
  return Buffer.concat([cipher.update(payload), cipher.final()]);
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
