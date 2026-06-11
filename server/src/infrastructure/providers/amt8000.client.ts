import { Socket } from 'node:net';

const DESTINATION = Buffer.from([0x00, 0x00]);
const SOURCE = Buffer.from([0x8f, 0xe0]);
const AUTH_COMMAND = Buffer.from([0xf0, 0xf0]);
const STATUS_COMMAND = Buffer.from([0x0b, 0x4a]);
const ARM_COMMAND = Buffer.from([0x40, 0x1e]);
const DISCONNECT_COMMAND = Buffer.from([0xf0, 0xf1]);
const ALL_PARTITIONS = 0xff;

const STATES: Record<number, Amt8000State> = {
  0: 'DISARMED',
  1: 'PARTIAL',
  3: 'ARMED',
};

const BATTERY_STATES: Record<number, Amt8000BatteryState> = {
  1: 'dead',
  2: 'low',
  3: 'middle',
  4: 'full',
};

export type Amt8000State = 'DISARMED' | 'PARTIAL' | 'ARMED' | 'UNKNOWN';
export type Amt8000BatteryState = 'dead' | 'low' | 'middle' | 'full' | 'unknown';

export interface Amt8000Partition {
  index: number;
  enabled: boolean;
  armed: boolean;
  stay: boolean;
  firing: boolean;
  fired: boolean;
}

export interface Amt8000Zone {
  number: number;
  enabled: boolean;
  open: boolean;
  violated: boolean;
  bypassed: boolean;
  tamper: boolean;
  lowBattery: boolean;
}

export interface Amt8000Status {
  model: number;
  version: string;
  state: Amt8000State;
  sirenLive: boolean;
  zonesFiring: boolean;
  zonesClosed: boolean;
  battery: Amt8000BatteryState;
  tamper: boolean;
  partitions: Amt8000Partition[];
  zones: Amt8000Zone[];
}

export class Amt8000Client {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password: string,
    private readonly timeoutMs = 5_000,
  ) {}

  async getStatus(): Promise<Amt8000Status> {
    this.validateConfig();
    const { socket, reader } = await this.connectAndAuthenticate();

    try {
      await writePacket(socket, packet(STATUS_COMMAND));
      const response = await reader.readFrame();
      const payloadLength = response.readUInt16BE(4) - 2;
      return parseStatus(response.subarray(8, 8 + payloadLength));
    } finally {
      await disconnect(socket);
    }
  }

  async arm(partition = ALL_PARTITIONS): Promise<Amt8000Status> {
    return this.setArmed(partition, true);
  }

  async disarm(partition = ALL_PARTITIONS): Promise<Amt8000Status> {
    return this.setArmed(partition, false);
  }

  private async setArmed(partition: number, armed: boolean): Promise<Amt8000Status> {
    this.validateConfig();
    if (partition !== ALL_PARTITIONS && (!Number.isInteger(partition) || partition < 1 || partition > 15)) {
      throw new Error('Particao AMT 8000 invalida. Use 1 a 15 ou todas.');
    }

    const { socket, reader } = await this.connectAndAuthenticate();
    try {
      await writePacket(socket, packet(ARM_COMMAND, Buffer.from([partition, armed ? 0x01 : 0x00])));
      if (armed) {
        try {
          const response = await reader.readFrame(800);
          if (response.length > 8 && response[8] === 0xf0) {
            throw new Error('Nao foi possivel armar: existem zonas abertas.');
          }
        } catch (error) {
          const message = messageFrom(error);
          if (!message.includes('Resposta incompleta') && !message.includes('Conexao encerrada')) throw error;
        }
      }
    } finally {
      await disconnect(socket);
    }

    await delay(250);
    return this.getStatus();
  }

  private async connectAndAuthenticate(): Promise<{ socket: Socket; reader: FrameReader }> {
    const socket = await this.connect();
    const reader = new FrameReader(socket, this.timeoutMs);
    try {
      const authPayload = Buffer.from([0x00, ...encodePassword(this.password), 0x10]);
      await writePacket(socket, packet(AUTH_COMMAND, authPayload));
      const authResponse = await reader.readFrame();
      const result = authResponse.length > 8 ? authResponse[8] : -1;
      if (result === 0x01) throw new Error('Senha da central AMT 8000 invalida.');
      if (result !== 0x00) throw new Error(`Autenticacao AMT 8000 recusada: codigo 0x${result.toString(16).padStart(2, '0')}.`);
      return { socket, reader };
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  private validateConfig() {
    if (!this.host.trim()) throw new Error('IP da central AMT 8000 obrigatorio.');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) throw new Error('Porta da central AMT 8000 invalida.');
    if (!/^\d{4}(\d{2})?$/.test(this.password)) throw new Error('Senha da central AMT 8000 deve ter 4 ou 6 digitos.');
  }

  private connect(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Tempo esgotado ao conectar na central AMT 8000 em ${this.host}:${this.port}.`));
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('error', onError);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new Error(`Falha ao conectar na central AMT 8000 em ${this.host}:${this.port}: ${error.message}`));
      };

      socket.once('error', onError);
      socket.connect(this.port, this.host, () => {
        cleanup();
        resolve(socket);
      });
    });
  }
}

class FrameReader {
  private buffer = Buffer.alloc(0);

  constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {}

  async readFrame(timeoutMs = this.timeoutMs): Promise<Buffer> {
    while (true) {
      if (this.buffer.length >= 6) {
        const frameLength = 6 + this.buffer.readUInt16BE(4) + 1;
        if (this.buffer.length >= frameLength) {
          const frame = this.buffer.subarray(0, frameLength);
          this.buffer = this.buffer.subarray(frameLength);
          validateChecksum(frame);
          return frame;
        }
      }
      this.buffer = Buffer.concat([this.buffer, await readChunk(this.socket, timeoutMs)]);
    }
  }
}

function packet(command: Buffer, payload = Buffer.alloc(0)): Buffer {
  const frame = Buffer.alloc(8 + payload.length);
  DESTINATION.copy(frame, 0);
  SOURCE.copy(frame, 2);
  frame.writeUInt16BE(command.length + payload.length, 4);
  command.copy(frame, 6);
  payload.copy(frame, 8);
  return Buffer.concat([frame, Buffer.from([checksum(frame)])]);
}

function checksum(data: Buffer): number {
  let value = 0;
  for (const byte of data) value ^= byte;
  return (value ^ 0xff) & 0xff;
}

function validateChecksum(frame: Buffer) {
  if (frame.length < 9 || checksum(frame.subarray(0, -1)) !== frame.at(-1)) {
    throw new Error('Resposta invalida da central AMT 8000.');
  }
}

function encodePassword(password: string): number[] {
  const digits = [...password].map((digit) => (digit === '0' ? 0x0a : Number(digit)));
  return password.length === 4 ? [0x0a, 0x0a, ...digits] : digits;
}

function writePacket(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

function readChunk(socket: Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.pause();
      cleanup();
      reject(new Error('Resposta incompleta da central AMT 8000.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onData = (data: Buffer) => {
      socket.pause();
      cleanup();
      resolve(data);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Conexao encerrada pela central AMT 8000.'));
    };

    socket.once('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.resume();
  });
}

async function disconnect(socket: Socket): Promise<void> {
  try {
    await writePacket(socket, packet(DISCONNECT_COMMAND));
  } catch {
    // The panel may close the connection immediately after replying.
  }
  socket.destroy();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseStatus(payload: Buffer): Amt8000Status {
  if (payload.length < 143) throw new Error(`Status incompleto da central AMT 8000: ${payload.length} bytes.`);
  const statusByte = payload[20];
  const partitions: Amt8000Partition[] = [];
  const zones: Amt8000Zone[] = [];

  for (let index = 0; index < 16; index += 1) {
    const value = payload[21 + index];
    if (!(value & 0x80)) continue;
    partitions.push({
      index,
      enabled: true,
      armed: Boolean(value & 0x01),
      stay: Boolean(value & 0x40),
      firing: Boolean(value & 0x04),
      fired: Boolean(value & 0x08),
    });
  }

  for (let index = 0; index < 56; index += 1) {
    const byteIndex = Math.floor(index / 8);
    const mask = 1 << (index % 8);
    if (!(payload[12 + byteIndex] & mask)) continue;
    zones.push({
      number: index + 1,
      enabled: true,
      open: Boolean(payload[38 + byteIndex] & mask),
      violated: Boolean(payload[46 + byteIndex] & mask),
      bypassed: Boolean(payload[54 + byteIndex] & mask),
      tamper: Boolean(payload[89 + byteIndex] & mask),
      lowBattery: Boolean(payload[105 + byteIndex] & mask),
    });
  }

  return {
    model: payload[0],
    version: `${payload[1]}.${payload[2]}.${payload[3]}`,
    state: STATES[(statusByte >> 5) & 0x03] || 'UNKNOWN',
    sirenLive: Boolean(statusByte & 0x02),
    zonesFiring: Boolean(statusByte & 0x08),
    zonesClosed: Boolean(statusByte & 0x04),
    battery: BATTERY_STATES[payload[134]] || 'unknown',
    tamper: Boolean(payload[71] & 0x02),
    partitions,
    zones,
  };
}
