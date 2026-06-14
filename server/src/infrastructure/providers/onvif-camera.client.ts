import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
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
  ptzAvailable?: boolean;
  ptzError?: string | null;
};

type PtzContext = { ptzUrl: string; profileToken: string };

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

  async probePtz(): Promise<{ available: boolean; error?: string | null }> {
    try {
      await this.ptzContext();
      return { available: true, error: null };
    } catch (error) {
      return { available: false, error: messageFrom(error) };
    }
  }

  async movePtz(pan: number, tilt: number, zoom: number, durationMs = 350): Promise<void> {
    const context = await this.ptzContext();
    const velocity = [
      pan || tilt ? `<tt:PanTilt x="${clamp(pan)}" y="${clamp(tilt)}"/>` : '',
      zoom ? `<tt:Zoom x="${clamp(zoom)}"/>` : '',
    ].join('');
    await this.soapRequest(
      context.ptzUrl,
      'http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove',
      `<tptz:ContinuousMove><tptz:ProfileToken>${xmlEscape(context.profileToken)}</tptz:ProfileToken><tptz:Velocity>${velocity}</tptz:Velocity></tptz:ContinuousMove>`,
    );
    await delay(Math.min(1_500, Math.max(100, durationMs)));
    await this.sendStopPtz(context);
  }

  async stopPtz(): Promise<void> {
    await this.sendStopPtz(await this.ptzContext());
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

  private async ptzContext(): Promise<PtzContext> {
    if (!this.username || !this.password) throw new Error('Credenciais ONVIF obrigatorias para detectar PTZ.');
    const deviceUrl = `http://${this.ip}/onvif/device_service`;
    const capabilities = await this.soapRequest(
      deviceUrl,
      'http://www.onvif.org/ver10/device/wsdl/GetCapabilities',
      '<td:GetCapabilities><td:Category>All</td:Category></td:GetCapabilities>',
    );
    const ptzUrl = serviceXAddr(capabilities, 'PTZ');
    const mediaUrl = serviceXAddr(capabilities, 'Media');
    if (!ptzUrl) throw new Error('Camera nao anunciou suporte PTZ via ONVIF.');
    if (!mediaUrl) throw new Error('Camera ONVIF sem servico de mídia.');
    const profiles = await this.soapRequest(mediaUrl, 'http://www.onvif.org/ver10/media/wsdl/GetProfiles', '<trt:GetProfiles/>');
    const profileToken = profiles.match(/<(?:\w+:)?Profiles\b[^>]*\btoken="([^"]+)"/i)?.[1];
    if (!profileToken) throw new Error('Camera ONVIF sem perfil de mídia para PTZ.');
    return { ptzUrl, profileToken };
  }

  private async sendStopPtz(context: PtzContext): Promise<void> {
    await this.soapRequest(
      context.ptzUrl,
      'http://www.onvif.org/ver20/ptz/wsdl/Stop',
      `<tptz:Stop><tptz:ProfileToken>${xmlEscape(context.profileToken)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`,
    );
  }

  private async soapRequest(url: string, action: string, body: string): Promise<string> {
    const envelope = soapEnvelope(this.username, this.password, body);
    const first = await postSoap(url, action, envelope, this.timeoutMs);
    if (first.statusCode === 401 && first.authenticate) {
      const challenge = parseDigestChallenge(first.authenticate);
      if (!challenge) throw new Error('Autenticacao HTTP ONVIF recusada.');
      const parsedUrl = new URL(url);
      const authorization = digestAuthorization('POST', `${parsedUrl.pathname}${parsedUrl.search}`, this.username, this.password, challenge);
      const authenticated = await postSoap(url, action, envelope, this.timeoutMs, authorization);
      return validateSoapResponse(authenticated);
    }
    return validateSoapResponse(first);
  }
}

function postSoap(url: string, action: string, body: string, timeoutMs: number, authorization?: string): Promise<{ statusCode: number; body: string; authenticate?: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
        'Content-Length': Buffer.byteLength(body),
        ...(authorization ? { Authorization: authorization } : {}),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: responseBody,
        authenticate: response.headers['www-authenticate'],
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Tempo esgotado na chamada ONVIF.')));
    request.on('error', reject);
    request.end(body);
  });
}

function validateSoapResponse(response: { statusCode: number; body: string }): string {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const fault = response.body.match(/<(?:\w+:)?Text[^>]*>([^<]+)</i)?.[1];
    throw new Error(fault || `Camera ONVIF respondeu HTTP ${response.statusCode}.`);
  }
  return response.body;
}

function soapEnvelope(username: string, password: string, body: string): string {
  const nonce = randomBytes(16);
  const created = new Date().toISOString();
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:td="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
<s:Header><wsse:Security s:mustUnderstand="1"><wsse:UsernameToken><wsse:Username>${xmlEscape(username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>
<s:Body>${body}</s:Body></s:Envelope>`;
}

function serviceXAddr(xml: string, service: string): string {
  return xml.match(new RegExp(`<(?:\\w+:)?${service}\\b[\\s\\S]*?<(?:\\w+:)?XAddr>([^<]+)`, 'i'))?.[1]?.trim() || '';
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, Number(value) || 0));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
