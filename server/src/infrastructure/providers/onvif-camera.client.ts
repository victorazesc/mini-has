import { createHash, randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import { JsonObject } from '../../types';

export type CameraProbeResult = {
  online: boolean;
  authenticated: boolean;
  streamAvailable: boolean;
  statusCode?: number | null;
  server?: string | null;
  publicMethods?: string | null;
  error?: string | null;
};

export class OnvifCameraClient {
  constructor(
    private readonly ip: string,
    private readonly port = 554,
    private readonly username = '',
    private readonly password = '',
    private readonly streamPath = '/cam/realmonitor?channel=1&subtype=0',
    private readonly timeoutMs = 2_500,
  ) {}

  async probe(): Promise<CameraProbeResult> {
    const uri = this.rtspUrl();
    const socket = await this.connect();
    if (!socket) return { online: false, authenticated: false, streamAvailable: false, error: 'Camera RTSP nao respondeu.' };

    try {
      const options = await this.exchange(socket, this.request('OPTIONS', uri));
      if (!options) return { online: false, authenticated: false, streamAvailable: false, error: 'Camera RTSP nao respondeu.' };

      const optionsStatus = statusCode(options);
      const headers = parseHeaders(options);
      if (!this.username || !this.password) {
        return {
          online: true,
          authenticated: optionsStatus !== 401,
          streamAvailable: false,
          statusCode: optionsStatus,
          server: headers.server || null,
          publicMethods: headers.public || null,
        };
      }

      const optionsChallenge = parseDigestChallenge(headers['www-authenticate']);
      if (optionsChallenge) {
        const authenticatedOptions = await this.exchange(socket, this.request('OPTIONS', uri, {
          Authorization: digestAuthorization('OPTIONS', uri, this.username, this.password, optionsChallenge),
        }, 2));
        const authenticatedOptionsStatus = statusCode(authenticatedOptions || '');
        if (authenticatedOptionsStatus && authenticatedOptionsStatus >= 200 && authenticatedOptionsStatus < 300) {
          const describe = await this.exchange(socket, this.request('DESCRIBE', uri, {
            Accept: 'application/sdp',
            Authorization: digestAuthorization('DESCRIBE', uri, this.username, this.password, optionsChallenge),
          }, 3));
          const describeStatus = statusCode(describe || '');
          return {
            online: true,
            authenticated: Boolean(describeStatus && describeStatus >= 200 && describeStatus < 300),
            streamAvailable: Boolean(describeStatus && describeStatus >= 200 && describeStatus < 300),
            statusCode: describeStatus,
            server: parseHeaders(describe || '').server || parseHeaders(authenticatedOptions || '').server || headers.server || null,
            error: describeStatus && describeStatus >= 200 && describeStatus < 300 ? null : 'Credenciais recusadas ou stream path invalido.',
          };
        }
      }

      const first = await this.exchange(socket, this.request('DESCRIBE', uri, { Accept: 'application/sdp' }, 2));
      if (!first) return { online: true, authenticated: false, streamAvailable: false, error: 'Camera nao respondeu ao DESCRIBE RTSP.' };
      const firstStatus = statusCode(first);
      if (firstStatus && firstStatus >= 200 && firstStatus < 300) {
        return { online: true, authenticated: true, streamAvailable: true, statusCode: firstStatus, server: parseHeaders(first).server || null };
      }

      const challenge = parseDigestChallenge(parseHeaders(first)['www-authenticate']);
      if (!challenge) {
        return { online: true, authenticated: false, streamAvailable: false, statusCode: firstStatus, error: 'Credenciais recusadas ou stream path invalido.' };
      }
      const authorization = digestAuthorization('DESCRIBE', uri, this.username, this.password, challenge);
      const authenticated = await this.exchange(socket, this.request('DESCRIBE', uri, { Accept: 'application/sdp', Authorization: authorization }, 3));
      const authenticatedStatus = statusCode(authenticated || '');
      return {
        online: true,
        authenticated: Boolean(authenticatedStatus && authenticatedStatus >= 200 && authenticatedStatus < 300),
        streamAvailable: Boolean(authenticatedStatus && authenticatedStatus >= 200 && authenticatedStatus < 300),
        statusCode: authenticatedStatus,
        server: parseHeaders(authenticated || '').server || headers.server || null,
        error: authenticatedStatus && authenticatedStatus >= 200 && authenticatedStatus < 300 ? null : 'Credenciais recusadas ou stream path invalido.',
      };
    } finally {
      socket.destroy();
    }
  }

  rtspUrl(): string {
    const path = this.streamPath.startsWith('/') ? this.streamPath : `/${this.streamPath}`;
    return `rtsp://${this.ip}:${this.port}${path}`;
  }

  private request(method: string, uri: string, headers: Record<string, string> = {}, cseq = 1): string {
    return [
      `${method} ${uri} RTSP/1.0`,
      `CSeq: ${cseq}`,
      'User-Agent: mini-has/1.0',
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
      '',
      '',
    ].join('\r\n');
  }

  private connect(): Promise<Socket | null> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let done = false;
      const finish = (value: Socket | null) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      socket.on('error', () => finish(null));
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => finish(socket));
      socket.once('timeout', () => {
        socket.destroy();
        finish(null);
      });
      socket.connect(this.port, this.ip);
    });
  }

  private exchange(socket: Socket, request: string): Promise<string | null> {
    return new Promise((resolve) => {
      let buffer = Buffer.alloc(0);
      let done = false;
      const timer = setTimeout(() => finish(buffer.length ? buffer.toString('utf8') : null), this.timeoutMs);
      const finish = (value: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('close', onClose);
        resolve(value);
      };
      const onClose = () => finish(buffer.length ? buffer.toString('utf8') : null);
      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const expectedLength = rtspResponseLength(buffer);
        if (expectedLength !== null && buffer.length >= expectedLength) {
          finish(buffer.subarray(0, expectedLength).toString('utf8'));
        }
      };
      socket.on('data', onData);
      socket.once('close', onClose);
      socket.write(request);
    });
  }
}

function statusCode(response: string): number | null {
  const value = Number(response.match(/^RTSP\/\d\.\d\s+(\d{3})/i)?.[1]);
  return Number.isFinite(value) ? value : null;
}

function parseHeaders(response: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of response.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(':');
    if (index < 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function rtspResponseLength(response: Buffer): number | null {
  const headerEnd = response.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const headers = response.subarray(0, headerEnd).toString('utf8');
  const contentLength = Number(headers.match(/\r?\ncontent-length:\s*(\d+)/i)?.[1] || 0);
  return headerEnd + 4 + (Number.isFinite(contentLength) ? contentLength : 0);
}

function parseDigestChallenge(value?: string): JsonObject | null {
  if (!value?.toLowerCase().startsWith('digest ')) return null;
  const challenge: JsonObject = {};
  for (const match of value.slice(7).matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|[^,\s]+)/g)) {
    challenge[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return challenge.realm && challenge.nonce ? challenge : null;
}

function digestAuthorization(method: string, uri: string, username: string, password: string, challenge: JsonObject): string {
  const realm = String(challenge.realm);
  const nonce = String(challenge.nonce);
  const qop = String(challenge.qop || '').split(',')[0].trim();
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const fields: JsonObject = { username, realm, nonce, uri, response };
  if (challenge.algorithm) fields.algorithm = challenge.algorithm;
  if (challenge.opaque) fields.opaque = challenge.opaque;
  if (qop) Object.assign(fields, { qop, nc, cnonce });
  return `Digest ${Object.entries(fields).map(([key, value]) => `${key}="${value}"`).join(', ')}`;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}
