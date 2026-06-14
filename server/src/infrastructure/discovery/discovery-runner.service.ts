import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { execFile } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import {
  CreateDiscoveryJobRequest,
  Device,
  DiscoveredDevice,
  DiscoveredService,
  JobStatus,
  JsonObject,
  ProbeMode,
  DiscoveryJob,
  SavedDiscoveryDevice,
  SavedDiscoveryScan,
} from '../../types';
import { StorageService } from '../storage/storage.service';

type DeviceReader = {
  listDevices(): Device[];
};

type InboxWriter = {
  upsertInboxItem(
    sourceType: string,
    sourceId: number,
    externalId: string,
    payload: JsonObject,
    secrets?: JsonObject,
    matchScore?: number,
  ): number;
};

const execFileAsync = promisify(execFile);

const DEFAULT_PORTS = [
  21,
  22,
  23,
  53,
  80,
  81,
  443,
  502,
  554,
  1883,
  5000,
  5353,
  6053,
  6607,
  6668,
  8000,
  8008,
  8009,
  8080,
  8123,
  8266,
  8554,
  8883,
  8899,
  9000,
  9009,
];

const HTTP_PORTS = new Set([80, 81, 5000, 8000, 8008, 8009, 8080, 8123, 8266, 9000]);
const HTTPS_PORTS = new Set([443]);
const RTSP_PORTS = new Set([554, 8554]);

const FALLBACK_MANUFACTURERS: Record<string, string> = {
  '08:3A:F2': 'Espressif',
  '24:0A:C4': 'Espressif',
  '30:AE:A4': 'Espressif',
  '3C:61:05': 'Espressif',
  '7C:DF:A1': 'Espressif',
  '84:F3:EB': 'Espressif',
  'A0:20:A6': 'Espressif',
  'AC:67:B2': 'Espressif',
  'B4:E6:2D': 'Espressif',
  'C4:5B:BE': 'Espressif',
  'CC:50:E3': 'Espressif',
  'D8:BF:C0': 'Espressif',
  'DC:4F:22': 'Espressif',
  'E0:5A:1B': 'Espressif',
  'EC:94:CB': 'Espressif',
  'FC:F5:C4': 'Espressif',
  '60:01:94': 'Espressif',
  '40:91:51': 'Espressif',
  '48:3F:DA': 'Espressif',
  '2C:F4:32': 'Espressif',
  'E8:DB:84': 'Espressif',
  '44:17:93': 'Espressif',
  '98:F4:AB': 'Espressif',
  '8C:AA:B5': 'Espressif',
  '34:85:18': 'Espressif',
  'D8:1F:12': 'Espressif',
  'CC:7B:5C': 'Espressif',
  'B8:06:0D': 'Espressif',
  '90:23:5B': 'Espressif',
  '48:78:5E': 'Espressif',
  'C8:98:28': 'TP-Link',
  'B4:1F:4D': 'TP-Link',
  'C4:EB:FF': 'TP-Link',
  '0C:8E:29': 'Tuya',
  '4C:A9:19': 'Samsung',
  '54:6C:AC': 'Intelbras',
};

@Injectable()
export class DiscoveryService {
  private readonly jobs = new Map<string, DiscoveryJob>();

  constructor(
    private readonly storage: StorageService,
    private readonly moduleRef: ModuleRef,
  ) { }

  createDiscoveryJob(rawRequest: CreateDiscoveryJobRequest): DiscoveryJob {
    const request = normalizeRequest(rawRequest);
    const now = this.storage.utcNow();
    const scanId = this.createScanRecord(request, 'pending', now);

    const job: DiscoveryJob = {
      id: String(scanId),
      status: 'pending',
      progress: 0,
      result: [],
      created_at: now,
    };

    this.jobs.set(job.id, job);
    return job;
  }

  async runDiscoveryJob(jobId: string, rawRequest: CreateDiscoveryJobRequest): Promise<void> {
    const request = normalizeRequest(rawRequest);

    this.updateJob(jobId, {
      status: 'running',
      started_at: this.storage.utcNow(),
      progress: 0.05,
    });

    try {
      const result = await this.runDiscovery(request);

      this.updateJob(jobId, {
        status: 'finished',
        progress: 1,
        result,
        finished_at: this.storage.utcNow(),
      });
    } catch (error) {
      this.updateJob(jobId, {
        status: 'failed',
        error: messageFrom(error),
        finished_at: this.storage.utcNow(),
      });
    }
  }

  async scanNow(
    rawRequest: CreateDiscoveryJobRequest,
    options: { upsertInbox?: boolean } = {},
  ): Promise<{ scanId: number; result: DiscoveredDevice[] }> {
    const request = normalizeRequest(rawRequest);
    const now = this.storage.utcNow();
    const scanId = this.createScanRecord(request, 'running', now, now);

    try {
      const result = await this.runDiscovery(request);

      this.updateScanRecord(
        scanId,
        {
          status: 'finished',
          result,
          finished_at: this.storage.utcNow(),
        },
        options,
      );

      return { scanId, result };
    } catch (error) {
      this.updateScanRecord(scanId, {
        status: 'failed',
        error: messageFrom(error),
        finished_at: this.storage.utcNow(),
      });

      throw error;
    }
  }

  listJobs(): DiscoveryJob[] {
    return this.listSavedScans().map((scan) => ({
      id: String(scan.id),
      status: scan.status,
      progress: scan.status === 'finished' ? 1 : 0,
      result: scan.result,
      error: scan.error,
      created_at: scan.created_at,
      started_at: scan.started_at,
      finished_at: scan.finished_at,
    }));
  }

  getJob(jobId: string): DiscoveryJob | null {
    const job = this.jobs.get(jobId);
    if (job) return job;

    const scan = this.getSavedScan(toInt(jobId));
    if (!scan) return null;

    return {
      id: String(scan.id),
      status: scan.status,
      progress: scan.status === 'finished' ? 1 : 0,
      result: scan.result,
      error: scan.error,
      created_at: scan.created_at,
      started_at: scan.started_at,
      finished_at: scan.finished_at,
    };
  }

  listSavedScans(limit = 100): SavedDiscoveryScan[] {
    return this.storage
      .all<JsonObject>('SELECT * FROM discovery_scans ORDER BY id DESC LIMIT ?', [limit])
      .map((row) => this.scanFromRow(row));
  }

  getSavedScan(scanId: number | null): SavedDiscoveryScan | null {
    if (scanId === null) return null;

    const row = this.storage.get<JsonObject>('SELECT * FROM discovery_scans WHERE id = ?', [scanId]);
    return row ? this.scanFromRow(row) : null;
  }

  listSavedDevices(): SavedDiscoveryDevice[] {
    return this.storage.all<JsonObject>('SELECT * FROM discovery_devices ORDER BY id').map((row) => ({
      id: row.id,
      lastScanId: row.last_scan_id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      device: this.storage.jsonLoad(row.payload_json, emptyDiscoveredDevice()),
    }));
  }

  private async runDiscovery(request: Required<CreateDiscoveryJobRequest>): Promise<DiscoveredDevice[]> {
    await pingSweep(request.subnet_prefix, request.timeout_seconds);

    let devices = filterValidDevices(
      mergeResults(await readArpTable()),
      request.subnet_prefix,
    );

    if (request.scan_ports) {
      const ips = devices.map((device) => device.ip).filter(Boolean) as string[];

      const portsByIp = await scanOpenPorts(
        ips,
        request.ports || DEFAULT_PORTS,
        1200,
      );

      devices = devices.map((device) =>
        mergeOpenPorts(device, portsByIp.get(device.ip || '') || []),
      );
    }

    devices = await probeDevices(
      filterValidDevices(devices, request.subnet_prefix),
      request.probeMode,
    );

    return this.identifyDevices(devices.map(enrichDevice)).sort(sortDevice);
  }

  private identifyDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
    const registered = this.moduleRef.get<DeviceReader>('DEVICE_SERVICE', { strict: false }).listDevices();

    return devices.map((device) => {
      const matched = registered.find((candidate) => {
        const local = candidate.payload.local as JsonObject | undefined;
        const payloadStatus = candidate.payload.status as JsonObject | undefined;
        const runtimeState = payloadStatus?.state as JsonObject | undefined;

        const localMac = normalizeMac(String(local?.mac || ''));
        const localIp = String(local?.ip || runtimeState?.ip || '');

        if (device.mac && localMac) {
          return localMac === normalizeMac(device.mac);
        }

        return Boolean(device.ip && localIp === device.ip);
      });

      if (matched) {
        const matchedLocal = matched.payload.local as JsonObject | undefined;
        const matchedByMac = Boolean(
          device.mac &&
          matchedLocal?.mac &&
          normalizeMac(String(matchedLocal.mac)) === normalizeMac(device.mac),
        );

        return {
          ...device,
          name: matched.name,
          model: String(matched.payload.model || device.model || matched.deviceType),
          deviceType: safeDeviceType(matched.deviceType),
          manufacturer: String(matched.payload.manufacturer || device.manufacturer || ''),
          confidence: 0.99,
          identification: {
            label: matched.name,
            reason: matchedByMac
              ? 'MAC corresponde a um dispositivo já cadastrado.'
              : 'IP corresponde a um dispositivo já cadastrado.',
            certainty: 'confirmed',
          },
        };
      }

      return identifyProbableDevice(device);
    });
  }

  private createScanRecord(
    request: JsonObject,
    status: JobStatus,
    createdAt: string,
    startedAt?: string,
  ): number {
    const result = this.storage.run(
      `
      INSERT INTO discovery_scans (status, request_json, result_json, created_at, started_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [status, this.storage.jsonDump(request), '[]', createdAt, startedAt],
    );

    return Number(result.lastInsertRowid);
  }

  private updateJob(jobId: string, updates: Partial<DiscoveryJob>): DiscoveryJob | null {
    const scanId = toInt(jobId);

    if (scanId !== null) {
      this.updateScanRecord(scanId, updates);
    }

    const job = this.getJob(jobId);
    if (!job) return null;

    const updated = { ...job, ...updates };
    this.jobs.set(jobId, updated);

    return updated;
  }

  private updateScanRecord(
    scanId: number,
    updates: Partial<DiscoveryJob>,
    options: { upsertInbox?: boolean } = {},
  ): SavedDiscoveryScan | null {
    const fields: JsonObject = {};

    if (updates.status) fields.status = updates.status;
    if (updates.result) fields.result_json = this.storage.jsonDump(updates.result.map(stripRaw));
    if ('error' in updates) fields.error = updates.error;
    if ('started_at' in updates) fields.started_at = updates.started_at;
    if ('finished_at' in updates) fields.finished_at = updates.finished_at;

    if (Object.keys(fields).length) {
      const assignments = Object.keys(fields)
        .map((field) => `${field} = ?`)
        .join(', ');

      this.storage.run(
        `UPDATE discovery_scans SET ${assignments} WHERE id = ?`,
        [...Object.values(fields), scanId],
      );
    }

    if (updates.result?.length) {
      this.saveDiscoveredDevices(
        scanId,
        updates.result,
        updates.finished_at || updates.started_at || this.storage.utcNow(),
        options.upsertInbox !== false,
      );
    }

    return this.getSavedScan(scanId);
  }

  private saveDiscoveredDevices(
    scanId: number,
    devices: DiscoveredDevice[],
    seenAt: string,
    upsertInbox = true,
  ): void {
    for (const device of devices) {
      const key = deviceKey(device);
      if (!key) continue;

      const previousRow = this.storage.get<JsonObject>(
        'SELECT payload_json FROM discovery_devices WHERE device_key = ?',
        [key],
      );

      const previous = previousRow
        ? this.storage.jsonLoad<DiscoveredDevice>(previousRow.payload_json, emptyDiscoveredDevice())
        : null;

      const savedDevice = previous ? mergeHistoricalDevice(previous, device) : device;

      this.storage.run(
        `
        INSERT INTO discovery_devices (device_key, payload_json, first_seen_at, last_seen_at, last_scan_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_key) DO UPDATE SET
          payload_json = excluded.payload_json,
          last_seen_at = excluded.last_seen_at,
          last_scan_id = excluded.last_scan_id
        `,
        [key, this.storage.jsonDump(stripRaw(savedDevice)), seenAt, seenAt, scanId],
      );

      if (upsertInbox) {
        this.upsertDiscoveryInbox(scanId, key, savedDevice);
      }
    }
  }

  private upsertDiscoveryInbox(scanId: number, key: string, device: DiscoveredDevice): void {
    const payload = {
      ...stripRaw(device),
      externalId: key,
      provider: 'discovery',
      localDeviceKey: key,
      scanId,
    };

    this.moduleRef
      .get<InboxWriter>('INBOX_SERVICE', { strict: false })
      .upsertInboxItem('discovery', 0, key, payload, {}, device.confidence);
  }

  private scanFromRow(row: JsonObject): SavedDiscoveryScan {
    return {
      id: row.id,
      status: row.status,
      request: this.storage.jsonLoad(row.request_json, {}),
      result: this.storage.jsonLoad(row.result_json, []),
      error: row.error,
      created_at: row.created_at,
      started_at: row.started_at,
      finished_at: row.finished_at,
    };
  }
}

function normalizeRequest(raw: CreateDiscoveryJobRequest): Required<CreateDiscoveryJobRequest> {
  return {
    subnet_prefix: raw?.subnet_prefix || localSubnetPrefix(),
    scan_ports: raw?.scan_ports ?? true,
    timeout_seconds: Math.min(15, Math.max(1, Number(raw?.timeout_seconds || 3))),
    probeMode: raw?.probeMode || 'aggressive',
    ports: raw?.ports || null,
  };
}

function localSubnetPrefix(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find(
      (item) => item.family === 'IPv4' && !item.internal && isPrivateIpv4(item.address),
    );

    if (address) {
      return address.address.split('.').slice(0, 3).join('.');
    }
  }

  return '192.168.0';
}

function isPrivateIpv4(value: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
}

async function pingSweep(subnetPrefix: string, timeoutSeconds: number): Promise<void> {
  const ips = subnetIps(subnetPrefix);

  await runLimited(ips, 64, async (ip) => {
    const args =
      process.platform === 'darwin'
        ? ['-c', '1', '-W', String(Math.floor(timeoutSeconds * 1000)), ip]
        : ['-c', '1', '-W', String(Math.max(1, Math.floor(timeoutSeconds))), ip];

    try {
      await execFileAsync('ping', args, {
        timeout: Math.floor((timeoutSeconds + 0.5) * 1000),
      });
    } catch {
      // ARP table is best-effort.
    }
  });
}

async function readArpTable(): Promise<JsonObject[]> {
  try {
    const { stdout } = await execFileAsync('arp', ['-an']);

    return stdout
      .split('\n')
      .map((line) => {
        const ip =
          line.match(/\((\d+\.\d+\.\d+\.\d+)\)/)?.[1] ||
          line.match(/^(\d+\.\d+\.\d+\.\d+)\s/)?.[1];

        const mac = line.match(/([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})/)?.[1];

        if (!ip || !mac) return null;

        return {
          ip,
          mac: mac
            .split(':')
            .map((part) => part.padStart(2, '0'))
            .join(':')
            .toUpperCase(),
          source: ['arp'],
        };
      })
      .filter(Boolean) as JsonObject[];
  } catch {
    return [];
  }
}

async function scanOpenPorts(
  ips: string[],
  ports: number[],
  timeout = 1200,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>(ips.map((ip) => [ip, []]));

  await runLimited(
    ips.flatMap((ip) => ports.map((port) => ({ ip, port }))),
    256,
    async ({ ip, port }) => {
      if (await canConnect(ip, port, timeout)) {
        result.get(ip)?.push(port);
      }
    },
  );

  for (const [ip, openPorts] of result) {
    result.set(ip, openPorts.sort((a, b) => a - b));
  }

  return result;
}

function canConnect(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, ip);
  });
}

async function probeDevices(
  devices: DiscoveredDevice[],
  probeMode: ProbeMode,
): Promise<DiscoveredDevice[]> {
  if (probeMode === 'light') {
    return Promise.all(devices.map(withReverseDns));
  }

  return runLimited(
    devices,
    probeMode === 'aggressive' ? 64 : 24,
    (device) => probeDevice(device, probeMode),
  );
}

async function probeDevice(
  device: DiscoveredDevice,
  probeMode: ProbeMode,
): Promise<DiscoveredDevice> {
  if (!device.ip) return device;

  const updates: Partial<DiscoveredDevice> = {};
  const services = [...(device.services || [])];
  const raw = { ...(device.raw || {}) };
  const hostname = await reverseDns(device.ip);

  let probed = false;

  if (hostname && !device.hostname) {
    updates.hostname = hostname;
  }

  let httpPorts = (device.openPorts || [])
    .filter((port) => HTTP_PORTS.has(port) || HTTPS_PORTS.has(port))
    .sort((a, b) => a - b);

  if (probeMode === 'balanced') {
    httpPorts = httpPorts.filter((port) => [80, 443, 8080, 8123, 8266].includes(port));
  }

  for (const result of await Promise.all(httpPorts.map((port) => probeHttp(device.ip as string, port)))) {
    if (!result) continue;

    probed = true;
    raw.probes = [...((raw.probes as JsonObject[]) || []), result];

    services.push(serviceFromHttp(result));
    mergeProbeIdentity(updates, result);
  }

  const rtspPorts = (device.openPorts || []).filter((port) => RTSP_PORTS.has(port));

  for (const result of await Promise.all(rtspPorts.map((port) => probeRtsp(device.ip as string, port)))) {
    if (!result) continue;

    probed = true;
    raw.probes = [...((raw.probes as JsonObject[]) || []), result];

    services.push({
      type: 'rtsp',
      port: Number(result.port),
      properties: {
        server: result.server,
        public: result.public,
      },
    });
  }

  const bannerPorts = (device.openPorts || []).filter(
    (port) =>
      [21, 22, 23, 1883, 6053, 8266, 8883].includes(port) &&
      (probeMode === 'aggressive' || [22, 6053, 8266].includes(port)),
  );

  for (const result of await Promise.all(bannerPorts.map((port) => probeBanner(device.ip as string, port)))) {
    if (!result) continue;

    probed = true;
    raw.probes = [...((raw.probes as JsonObject[]) || []), result];

    services.push(serviceFromBanner(result));
    mergeProbeIdentity(updates, result);
  }

  if (probed) {
    updates.source = [...new Set([...(device.source || []), 'probe'])].sort();
  }

  if (Object.keys(raw).length) {
    updates.raw = raw;
  }

  if (services.length) {
    updates.services = dedupeServices(services);
  }

  return { ...device, ...updates };
}

async function withReverseDns(device: DiscoveredDevice): Promise<DiscoveredDevice> {
  if (!device.ip || device.hostname) return device;

  const hostname = await reverseDns(device.ip);

  return hostname ? { ...device, hostname } : device;
}

async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip);
    return names[0]?.replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

async function probeHttp(ip: string, port: number): Promise<JsonObject | null> {
  if (HTTPS_PORTS.has(port)) return null;

  return new Promise((resolve) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];

    const finish = (value: JsonObject | null) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(1800);

    socket.once('connect', () => {
      socket.write(
        `GET / HTTP/1.1\r\nHost: ${ip}\r\nUser-Agent: mini-has/1.0\r\nConnection: close\r\n\r\n`,
      );
    });

    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    socket.once('close', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      if (!data) return finish(null);

      const [head, body = ''] = data.split('\r\n\r\n');
      const headers = parseHttpHeaders(head);

      const status = headers[':status'];
      const statusCode = status ? Number(status) : undefined;

      finish({
        type: 'http',
        scheme: 'http',
        port,
        status,
        statusCode,
        authRequired: statusCode === 401,
        server: headers.server,
        title: htmlTitle(body),
        realm: authRealm(headers['www-authenticate'] || ''),
        location: headers.location,
        model: modelFromHttp(headers, body),
      });
    });

    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));

    socket.connect(port, ip);
  });
}

async function probeRtsp(ip: string, port: number): Promise<JsonObject | null> {
  const response = await tcpExchange(
    ip,
    port,
    `OPTIONS rtsp://${ip}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: mini-has/1.0\r\n\r\n`,
    1200,
  );

  if (!response || !response.includes('RTSP/')) return null;

  const headers = parseHeaderLines(response.split('\n').slice(1));

  return {
    type: 'rtsp',
    port,
    server: headers.server,
    public: headers.public,
  };
}

async function probeBanner(ip: string, port: number): Promise<JsonObject | null> {
  const response = await tcpExchange(ip, port, '', 800);
  const banner = (response || '').trim();

  if (!banner) return syntheticBanner(port);

  return {
    type: serviceTypeForPort(port),
    port,
    banner,
  };
}

function tcpExchange(
  ip: string,
  port: number,
  request: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];

    const finish = (value: string | null) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      if (request) socket.write(request);
    });

    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    socket.once('close', () => finish(Buffer.concat(chunks).toString('utf8')));
    socket.once('timeout', () => finish(Buffer.concat(chunks).toString('utf8') || null));
    socket.once('error', () => finish(null));

    socket.connect(port, ip);
  });
}

function mergeResults(items: JsonObject[]): DiscoveredDevice[] {
  const devices = new Map<string, DiscoveredDevice>();

  for (const item of items) {
    const normalized = toDevice(item);
    const key = findExistingKey(devices, normalized) || deviceKey(normalized) || `unknown:${devices.size}`;
    const existing = devices.get(key);

    devices.set(key, existing ? mergeDevice(existing, normalized) : normalized);
  }

  return [...devices.values()];
}

function toDevice(item: JsonObject): DiscoveredDevice {
  return {
    ip: item.ip,
    hostname: item.hostname,
    mac: normalizeMac(String(item.mac || '')),
    name: cleanDeviceName(String(item.name || '')) || undefined,
    manufacturer: item.manufacturer,
    model: item.model,
    deviceType: item.deviceType || item.device_type,
    source: Array.isArray(item.source) ? item.source : [],
    services: Array.isArray(item.services) ? item.services : [],
    openPorts: Array.isArray(item.openPorts)
      ? item.openPorts
      : Array.isArray(item.open_ports)
        ? item.open_ports
        : [],
    confidence: Number(item.confidence || 0),
    raw: item.raw || {},
  };
}

function findExistingKey(devices: Map<string, DiscoveredDevice>, device: DiscoveredDevice): string | null {
  for (const [key, current] of devices) {
    if (device.mac && current.mac && device.mac.toUpperCase() === current.mac.toUpperCase()) {
      return key;
    }

    if (device.ip && current.ip && device.ip === current.ip) {
      return key;
    }

    if (device.hostname && current.hostname && device.hostname.toLowerCase() === current.hostname.toLowerCase()) {
      return key;
    }
  }

  return null;
}

function mergeDevice(left: DiscoveredDevice, right: DiscoveredDevice): DiscoveredDevice {
  return {
    ...left,
    ip: left.ip || right.ip,
    hostname: left.hostname || right.hostname,
    mac: normalizeMac(left.mac || right.mac),
    name: cleanDeviceName(left.name) || cleanDeviceName(right.name) || undefined,
    manufacturer: left.manufacturer || right.manufacturer,
    model: left.model || right.model,
    deviceType: left.deviceType || right.deviceType,
    source: [...new Set([...(left.source || []), ...(right.source || [])])].sort(),
    services: dedupeServices([...(left.services || []), ...(right.services || [])]),
    openPorts: [...new Set([...(left.openPorts || []), ...(right.openPorts || [])])].sort((a, b) => a - b),
    raw: { ...(left.raw || {}), ...(right.raw || {}) },
  };
}

function mergeHistoricalDevice(previous: DiscoveredDevice, current: DiscoveredDevice): DiscoveredDevice {
  const merged = mergeDevice(current, previous);

  if (identificationRank(previous.identification) <= identificationRank(current.identification)) {
    return merged;
  }

  return {
    ...merged,
    name: cleanDeviceName(previous.name) || cleanDeviceName(merged.name) || merged.name,
    model: previous.model || merged.model,
    deviceType: previous.deviceType || merged.deviceType,
    identification: previous.identification,
    confidence: Math.max(previous.confidence || 0, current.confidence || 0),
  };
}

function identificationRank(identification?: DiscoveredDevice['identification']): number {
  if (identification?.certainty === 'confirmed') return 3;
  if (identification?.certainty === 'probable') return 2;
  if (identification?.certainty === 'limited') return 1;
  return 0;
}

function mergeOpenPorts(device: DiscoveredDevice, ports: number[]): DiscoveredDevice {
  if (!ports.length) return device;

  const portServices: DiscoveredService[] = ports.map((port) => ({
    type: serviceTypeForPort(port),
    port,
    properties: {
      open: true,
      source: 'port_scan',
    },
  }));

  return {
    ...device,
    source: [...new Set([...(device.source || []), 'port_scan'])].sort(),
    openPorts: [...new Set([...(device.openPorts || []), ...ports])].sort((a, b) => a - b),
    services: dedupeServices([...(device.services || []), ...portServices]),
  };
}

function filterValidDevices(devices: DiscoveredDevice[], subnetPrefix: string): DiscoveredDevice[] {
  return devices.filter((device) => isValidDevice(device, subnetPrefix));
}

function isValidDevice(device: DiscoveredDevice, subnetPrefix: string): boolean {
  if (!device.ip && !device.hostname && !device.mac) return false;
  if (device.mac?.toUpperCase() === 'FF:FF:FF:FF:FF:FF') return false;

  if (!device.ip) return true;
  if (device.ip.endsWith('.255')) return false;

  return subnetPrefix.includes('/')
    ? cidrContains(subnetPrefix, device.ip)
    : device.ip.startsWith(`${subnetPrefix.replace(/\.$/, '')}.`);
}

function enrichDevice(device: DiscoveredDevice): DiscoveredDevice {
  const manufacturer = device.manufacturer || lookupManufacturer(device.mac);
  const deviceType = safeDeviceType(device.deviceType || inferDeviceType(device, manufacturer));
  const name = cleanDeviceName(device.name) || device.name;

  return {
    ...device,
    name,
    manufacturer,
    deviceType,
    confidence: confidence(device, manufacturer, deviceType),
  };
}

function identifyProbableDevice(device: DiscoveredDevice): DiscoveredDevice {
  const services = (device.services || [])
    .map((service) =>
      [
        service.type,
        service.name,
        ...Object.values(service.properties || {}),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ')
    .toLowerCase();

  const manufacturer = String(device.manufacturer || '').toLowerCase();
  const ports = new Set(device.openPorts || []);
  const currentDeviceType = safeDeviceType(device.deviceType);

  if (services.includes('airtunes') || services.includes('airplay')) {
    return withIdentification(
      device,
      'Dispositivo Apple / AirPlay',
      'Serviço AirTunes/AirPlay detectado na rede.',
      'probable',
      'media',
    );
  }

  if (String(device.name || '').toLowerCase().includes('mainsail')) {
    return withIdentification(
      device,
      'Impressora 3D / Mainsail',
      'Interface Mainsail detectada via HTTP.',
      'probable',
      'printer',
    );
  }

  if (ports.has(9009)) {
    return withIdentification(
      device,
      'Central Intelbras AMT 8000 PRO',
      'Porta ISECNet v2 9009 detectada.',
      'confirmed',
      'alarm',
    );
  }

  if (ports.has(502)) {
    return withIdentification(
      device,
      'Possível inversor solar / Modbus TCP',
      'Porta Modbus TCP 502 detectada, comum em inversores e medidores de energia.',
      'probable',
      'solar_inverter',
    );
  }

  if (ports.has(6607)) {
    return withIdentification(
      device,
      'Possível logger Solarman/Deye',
      'Porta 6607 detectada, comum em alguns dataloggers Solarman/Deye.',
      'probable',
      'solar_inverter',
    );
  }

  if (ports.has(8899)) {
    return withIdentification(
      device,
      'Logger de inversor solar',
      'Porta local de logger solar 8899 detectada.',
      'probable',
      'solar_inverter',
    );
  }

  if (currentDeviceType === 'camera' || ports.has(554) || ports.has(8554)) {
    return withIdentification(
      device,
      'Possível câmera IP',
      'Serviço de vídeo RTSP detectado.',
      'probable',
      'camera',
    );
  }

  if (ports.has(6668) || manufacturer.includes('tuya')) {
    return withIdentification(
      device,
      'Dispositivo Tuya local',
      'Porta local Tuya 6668 ou fabricante Tuya detectado.',
      'probable',
      'iot',
    );
  }

  if (hasAnyPort(ports, [80, 81, 5000, 8000, 8008, 8009, 8080, 8123, 8266, 9000])) {
    return withIdentification(
      device,
      'Dispositivo HTTP protegido',
      'Serviço HTTP detectado na rede. O dispositivo pode exigir autenticação.',
      'limited',
      currentDeviceType === 'unknown' ? 'unknown_iot' : currentDeviceType,
    );
  }

  if (device.ip?.endsWith('.1')) {
    return withIdentification(
      device,
      `Roteador / gateway${cleanDeviceName(device.name) ? ` ${cleanDeviceName(device.name)}` : ''}`,
      'Endereço de gateway e interface de rede detectada.',
      'probable',
      'network',
    );
  }

  if (currentDeviceType === 'network') {
    return withIdentification(
      device,
      `Equipamento de rede ${cleanDeviceName(device.name) || device.manufacturer || ''}`.trim(),
      'Interface e comportamento de equipamento de rede.',
      'probable',
      'network',
    );
  }

  if (isPrivateMac(device.mac)) {
    return withIdentification(
      device,
      'Dispositivo com MAC privado',
      'MAC aleatório impede identificar fabricante e modelo com segurança.',
      'limited',
      currentDeviceType,
    );
  }

  if (device.manufacturer) {
    return withIdentification(
      device,
      `Dispositivo ${device.manufacturer}`,
      'Identificação limitada ao fabricante do endereço MAC.',
      'limited',
      currentDeviceType,
    );
  }

  if ((device.services || []).length || (device.openPorts || []).length) {
    return withIdentification(
      device,
      'Dispositivo IoT desconhecido',
      'Serviço de rede detectado, mas sem assinatura suficiente para identificar o tipo.',
      'limited',
      'unknown_iot',
    );
  }

  return withIdentification(
    device,
    'Dispositivo desconhecido',
    'Nenhum serviço, hostname ou fabricante confiável foi encontrado.',
    'limited',
    currentDeviceType,
  );
}

function withIdentification(
  device: DiscoveredDevice,
  label: string,
  reason: string,
  certainty: 'confirmed' | 'probable' | 'limited',
  deviceType: string,
): DiscoveredDevice {
  return {
    ...device,
    name: cleanDeviceName(device.name) || label,
    deviceType: safeDeviceType(deviceType),
    identification: {
      label,
      reason,
      certainty,
    },
  };
}

function inferDeviceType(device: DiscoveredDevice, manufacturer?: string | null): string {
  const serviceBlob = (device.services || [])
    .map((service) =>
      [
        service.type,
        service.name,
        ...Object.values(service.properties || {}),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ')
    .toLowerCase();

  const identity = [
    device.hostname,
    device.name,
    device.model,
    manufacturer,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const ports = new Set(device.openPorts || []);
  const text = `${serviceBlob} ${identity}`;

  if (text.includes('_printer') || identity.includes('printer')) return 'printer';

  if (
    hasAny(text, [
      'googlecast',
      'mediarenderer',
      'dlna',
      'dial',
      'chromecast',
      'smart tv',
      'airtunes',
      'airplay',
    ])
  ) {
    return 'media';
  }

  if (ports.has(9009) || text.includes('isecnet')) return 'alarm';

  if (
    ports.has(502) ||
    ports.has(6607) ||
    ports.has(8899) ||
    hasAny(text, [
      'solar',
      'inverter',
      'inversor',
      'solarman',
      'deye',
      'growatt',
      'goodwe',
      'sungrow',
      'sofar',
      'solis',
      'ginlong',
      'fronius',
      'solaredge',
    ])
  ) {
    return 'solar_inverter';
  }

  if (
    ports.has(554) ||
    ports.has(8554) ||
    hasAny(text, [
      'rtsp',
      'onvif',
      'hikvision',
      'dahua',
      'ip camera',
      'camera',
    ])
  ) {
    return 'camera';
  }

  if (
    hasAny(text, [
      'espressif',
      'arduino',
      'esphome',
      '_esphomelib',
      '_arduino',
      '_hap',
      '_matter',
    ])
  ) {
    return 'iot';
  }

  if (
    ports.has(6053) ||
    ports.has(8266) ||
    ports.has(1883) ||
    ports.has(8883) ||
    ports.has(6668) ||
    serviceBlob.includes('_mqtt')
  ) {
    return 'iot';
  }

  if (ports.has(53) && (ports.has(80) || ports.has(443))) return 'network';

  if (
    hasAny(text, [
      'router',
      'gateway',
      'openwrt',
      'routeros',
      'tplink',
      'tp-link',
      'ubiquiti',
      'mikrotik',
    ])
  ) {
    return 'network';
  }

  if (
    !(device.services || []).length &&
    !(device.openPorts || []).length &&
    hasAny(String(manufacturer || '').toLowerCase(), ['apple', 'samsung', 'xiaomi', 'motorola'])
  ) {
    return 'mobile';
  }

  if ((device.services || []).length || (device.openPorts || []).length) {
    return 'unknown_iot';
  }

  return 'unknown';
}

function isPrivateMac(mac?: string | null): boolean {
  if (!mac) return false;

  const firstOctet = Number.parseInt(mac.split(':')[0] || '', 16);

  return Number.isFinite(firstOctet) && (firstOctet & 2) === 2;
}

function confidence(
  device: DiscoveredDevice,
  manufacturer: string | null | undefined,
  deviceType: string,
): number {
  let score = 0.2;

  score += Math.min((device.source || []).length, 3) * 0.12;
  score += device.ip ? 0.18 : 0;
  score += device.mac ? 0.14 : 0;
  score += device.hostname ? 0.1 : 0;
  score += cleanDeviceName(device.name) ? 0.08 : 0;
  score += device.model ? 0.06 : 0;
  score += (device.services || []).length ? 0.14 : 0;
  score += (device.openPorts || []).length ? 0.1 : 0;
  score += manufacturer ? 0.06 : 0;
  score += deviceType !== 'unknown' ? 0.08 : -0.04;

  return Math.round(Math.max(0.1, Math.min(score, 0.98)) * 100) / 100;
}

function serviceFromHttp(result: JsonObject): DiscoveredService {
  const status = String(result.status || result.statusCode || '');
  const statusCode = status ? Number(status) : undefined;
  const authRequired = statusCode === 401;

  const serviceName =
    cleanDeviceName(String(result.title || '')) ||
    cleanDeviceName(String(result.realm || '')) ||
    cleanDeviceName(String(result.server || '')) ||
    (statusCode ? `HTTP ${statusCode}` : 'HTTP service');

  return {
    type: String(result.scheme || 'http'),
    port: Number(result.port),
    name: serviceName,
    properties: {
      ...result,
      open: true,
      statusCode,
      authRequired,
    },
  };
}

function serviceFromBanner(result: JsonObject): DiscoveredService {
  return {
    type: String(result.type || 'tcp'),
    port: Number(result.port),
    properties: result,
  };
}

function mergeProbeIdentity(updates: Partial<DiscoveredDevice>, result: JsonObject): void {
  const title = cleanDeviceName(String(result.title || ''));
  const model = cleanDeviceName(String(result.model || ''));

  if (!updates.name && title) {
    updates.name = title.slice(0, 80);
  }

  if (!updates.model && model) {
    updates.model = model.slice(0, 120);
  }
}

function parseHttpHeaders(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const headers: Record<string, string> = {};
  const parts = (lines[0] || '').split(/\s+/);

  if (parts.length >= 2) {
    headers[':status'] = parts[1];
  }

  return {
    ...headers,
    ...parseHeaderLines(lines.slice(1)),
  };
}

function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const index = line.indexOf(':');
    if (index < 0) continue;

    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }

  return headers;
}

function htmlTitle(value: string): string | null {
  const match = value.match(/<title[^>]*>(.*?)<\/title>/is);

  return match
    ? decodeHtml(match[1])
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
    : null;
}

function authRealm(value: string): string | null {
  return value.match(/realm="([^"]+)"/i)?.[1] || null;
}

function modelFromHttp(headers: Record<string, string>, body: string): string | null {
  const server = headers.server || '';

  if (server) return server.slice(0, 120);

  return body.match(/model["'\s:=]+([A-Za-z0-9_. -]{2,80})/i)?.[1]?.trim() || null;
}

function syntheticBanner(port: number): JsonObject | null {
  if (port === 6053) return { type: 'esphome', port };
  if (port === 8266) return { type: 'arduino-ota', port };
  if ([1883, 8883].includes(port)) return { type: port === 8883 ? 'mqtts' : 'mqtt', port };

  return null;
}

function serviceTypeForPort(port: number): string {
  return (
    {
      21: 'ftp',
      22: 'ssh',
      23: 'telnet',
      53: 'dns',
      80: 'http',
      81: 'http',
      443: 'https',
      502: 'modbus-tcp',
      554: 'rtsp',
      1883: 'mqtt',
      5000: 'http',
      5353: 'mdns',
      6053: 'esphome',
      6607: 'solarman-deye',
      6668: 'tuya-local',
      8000: 'http',
      8008: 'http',
      8009: 'http',
      8080: 'http',
      8123: 'home-assistant',
      8266: 'arduino-ota',
      8554: 'rtsp',
      8883: 'mqtts',
      8899: 'solar-logger',
      9000: 'http',
      9009: 'isecnet-v2',
    } as Record<number, string>
  )[port] || `tcp/${port}`;
}

function dedupeServices(services: DiscoveredService[]): DiscoveredService[] {
  const deduped = new Map<string, DiscoveredService>();

  for (const service of services) {
    const key = `${service.type || ''}:${service.port || ''}:${service.name || ''}`;
    const existing = deduped.get(key);

    deduped.set(key, {
      ...(existing || {}),
      ...service,
      properties: {
        ...(existing?.properties || {}),
        ...(service.properties || {}),
      },
    });
  }

  return [...deduped.values()];
}

function deviceKey(device: DiscoveredDevice): string | null {
  if (device.mac) return `mac:${device.mac.toUpperCase()}`;
  if (device.ip) return `ip:${device.ip}`;
  if (device.hostname) return `host:${device.hostname.toLowerCase()}`;

  return null;
}

function sortDevice(left: DiscoveredDevice, right: DiscoveredDevice): number {
  if (left.ip && right.ip) return ipToInt(left.ip) - ipToInt(right.ip);
  if (left.ip) return -1;
  if (right.ip) return 1;

  return String(left.hostname || left.name || '').localeCompare(String(right.hostname || right.name || ''));
}

function subnetIps(subnetPrefix: string): string[] {
  if (!subnetPrefix.includes('/')) {
    return Array.from(
      { length: 254 },
      (_, index) => `${subnetPrefix.replace(/\.$/, '')}.${index + 1}`,
    );
  }

  const [ip, prefixText] = subnetPrefix.split('/');
  const prefix = Number(prefixText);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToInt(ip) & mask;
  const broadcast = network | (~mask >>> 0);
  const ips: string[] = [];

  for (let value = network + 1; value < broadcast; value += 1) {
    ips.push(intToIp(value));
  }

  return ips;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [base, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipToInt(base) & mask) === (ipToInt(ip) & mask);
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function lookupManufacturer(mac?: string | null): string | null {
  const prefix = macPrefix(mac);

  return prefix ? FALLBACK_MANUFACTURERS[prefix] || null : null;
}

function macPrefix(mac?: string | null): string | null {
  if (!mac) return null;

  const parts = mac.toUpperCase().replaceAll('-', ':').split(':');

  if (parts.length < 3) return null;

  return parts
    .slice(0, 3)
    .map((part) => part.padStart(2, '0'))
    .join(':');
}

function normalizeMac(mac?: string | null): string | null {
  const normalized = String(mac || '').trim();

  return normalized ? normalized.toUpperCase() : null;
}

function stripRaw(device: DiscoveredDevice): DiscoveredDevice {
  const { raw: _raw, ...rest } = device;

  return rest;
}

function emptyDiscoveredDevice(): DiscoveredDevice {
  return {
    source: [],
    services: [],
    openPorts: [],
    confidence: 0,
  };
}

async function runLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function next(): Promise<void> {
    const current = index++;

    if (current >= items.length) return;

    results[current] = await worker(items[current]);

    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));

  return results;
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function hasAnyPort(ports: Set<number>, values: number[]): boolean {
  return values.some((port) => ports.has(port));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanDeviceName(value?: string | null): string | null {
  if (!value) return null;

  const name = value.trim();
  if (!name) return null;

  const normalized = name.toLowerCase();

  const invalidNames = [
    '401 unauthorized',
    '403 forbidden',
    '404 not found',
    '500 internal server error',
    'unauthorized',
    'forbidden',
    'not found',
    'httpd',
    'http service',
  ];

  if (invalidNames.includes(normalized)) return null;
  if (/^\d{3}\s/.test(normalized)) return null;

  return name;
}

function safeDeviceType(value?: string | null, fallback = 'unknown'): string {
  const normalized = String(value || '').trim();

  return normalized || fallback;
}

function toInt(value: string | number | null | undefined): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}