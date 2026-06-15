import { Injectable } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { DiscoveryService } from '../../infrastructure/discovery/discovery-runner.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { SavedDiscoveryDevice } from '../../types';

type SolarLogger = {
  ip: string;
  mac?: string | null;
  serial?: string | null;
  loggerSerial?: string | null;
  firmware?: string | null;
  currentPowerW?: number | null;
  todayEnergyKwh?: number | null;
  totalEnergyKwh?: number | null;
  signalPercent?: number | null;
  alarm?: string | null;
  serverConnected?: boolean | null;
  online: boolean;
  error?: string | null;
  fetchedAt: string;
};

type SolarCandidate = {
  ip: string;
  mac?: string | null;
};

type LoggerCacheEntry = {
  values: Record<string, string>;
  cachedAt: number;
};

type SolarHistoryBucket = 'hour' | 'day';

type SolarHistoryRange = '24h' | '7d' | '30d' | '90d';

type SolarHistoryRow = {
  bucket_start: string;
  samples: number;
  avg_power_w: number | null;
  max_power_w: number | null;
  min_today_energy_kwh: number | null;
  max_today_energy_kwh: number | null;
  min_total_energy_kwh: number | null;
  max_total_energy_kwh: number | null;
  total_energy_kwh: number | null;
};

const SUBNET_SCAN_CACHE_TTL_MS = 5 * 60_000;
const LOGGER_VALUES_CACHE_TTL_MS = 30_000;
const SOLAR_READING_MIN_INTERVAL_MS = Number(process.env.LOCAL_SOLAR_READING_MIN_INTERVAL_MS || 60_000);

@Injectable()
export class SolarService {
  private readonly loggerCache = new Map<string, LoggerCacheEntry>();
  private lastSubnetScanAt = 0;
  private subnetScanPromise?: Promise<string[]>;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly storage: StorageService,
  ) {}

  async listLoggers(options: { refreshNetwork?: boolean } = {}) {
    const candidatesByIp = new Map<string, SolarCandidate>();

    for (const saved of this.discovery.listSavedDevices().filter(isSolarLogger)) {
      const ip = String(saved.device.ip || '').trim();
      if (!ip) continue;
      candidatesByIp.set(ip, { ip, mac: saved.device.mac });
    }

    for (const ip of await this.discoverLoggerIps(Boolean(options.refreshNetwork))) {
      if (!candidatesByIp.has(ip)) candidatesByIp.set(ip, { ip });
    }

    const loggers: SolarLogger[] = [];
    for (const candidate of sortCandidates([...candidatesByIp.values()])) {
      loggers.push(await this.readLogger(candidate));
    }

    const online = loggers.filter((logger) => logger.online);

    return {
      loggers,
      summary: {
        discovered: loggers.length,
        online: online.length,
        currentPowerW: sum(online, 'currentPowerW'),
        todayEnergyKwh: sum(online, 'todayEnergyKwh'),
        totalEnergyKwh: sum(online, 'totalEnergyKwh'),
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  async scanLoggers() {
    return this.listLoggers({ refreshNetwork: true });
  }

  private async discoverLoggerIps(force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && this.loggerCache.size && now - this.lastSubnetScanAt < SUBNET_SCAN_CACHE_TTL_MS) {
      return sortIps([...this.loggerCache.keys()]);
    }

    if (!this.subnetScanPromise) {
      this.subnetScanPromise = this.scanSubnetForLoggers().finally(() => {
        this.subnetScanPromise = undefined;
      });
    }

    return this.subnetScanPromise;
  }

  private async scanSubnetForLoggers(): Promise<string[]> {
    const authorization = basicAuthorization();
    const nextCache = new Map<string, LoggerCacheEntry>();
    const prefixes = loggerSubnetPrefixes();
    const concurrency = Math.max(8, Number(process.env.LOCAL_SOLAR_SCAN_CONCURRENCY || 48));

    for (const prefix of prefixes) {
      const hosts = Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);
      await runWithConcurrency(hosts, concurrency, async (ip) => {
        const values = await probeLoggerHost(ip, authorization);
        if (!values) return;
        nextCache.set(ip, { values, cachedAt: Date.now() });
      });
    }

    if (nextCache.size) {
      this.loggerCache.clear();
      for (const [ip, entry] of nextCache.entries()) this.loggerCache.set(ip, entry);
    }

    this.lastSubnetScanAt = Date.now();
    return sortIps([...this.loggerCache.keys()]);
  }

  private async readLogger(candidate: SolarCandidate): Promise<SolarLogger> {
    const ip = candidate.ip;
    const fetchedAt = new Date().toISOString();

    try {
      const cached = this.loggerCache.get(ip);
      const values = await fetchLoggerVariables(
        ip,
        basicAuthorization(),
        cached && Date.now() - cached.cachedAt < LOGGER_VALUES_CACHE_TTL_MS ? cached.values : undefined,
      );

      this.loggerCache.set(ip, { values, cachedAt: Date.now() });

      const logger = {
        ip,
        mac: clean(values.cover_sta_mac) || candidate.mac,
        serial: clean(values.webdata_sn),
        loggerSerial: clean(values.cover_mid),
        firmware: clean(values.cover_ver),
        currentPowerW: numberValue(values.webdata_now_p),
        todayEnergyKwh: numberValue(values.webdata_today_e),
        totalEnergyKwh: numberValue(values.webdata_total_e),
        signalPercent: numberValue(values.cover_sta_rssi),
        alarm: clean(values.webdata_alarm),
        serverConnected: values.status_a ? values.status_a === '1' : null,
        online: true,
        fetchedAt,
      };

      this.recordLoggerReading(logger, values);
      return logger;
    } catch (error) {
      return {
        ip,
        mac: candidate.mac,
        online: false,
        error: error instanceof Error ? error.message : 'Falha ao consultar logger local.',
        fetchedAt,
      };
    }
  }

  listHistory(options: { range?: string; bucket?: string; ip?: string } = {}) {
    const range = solarHistoryRange(options.range);
    const bucket = solarHistoryBucket(options.bucket, range);
    const since = new Date(Date.now() - solarHistoryRangeMs(range)).toISOString();
    const params: unknown[] = [since];
    let ipFilter = '';

    if (options.ip && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(options.ip)) {
      ipFilter = 'AND ip = ?';
      params.push(options.ip);
    }

    const bucketExpression = bucket === 'day'
      ? "substr(created_at, 1, 10) || 'T00:00:00.000Z'"
      : "substr(created_at, 1, 13) || ':00:00.000Z'";

    const rows = this.storage.all<SolarHistoryRow>(`
      SELECT
        ${bucketExpression} AS bucket_start,
        COUNT(*) AS samples,
        AVG(current_power_w) AS avg_power_w,
        MAX(current_power_w) AS max_power_w,
        MIN(today_energy_kwh) AS min_today_energy_kwh,
        MAX(today_energy_kwh) AS max_today_energy_kwh,
        MIN(total_energy_kwh) AS min_total_energy_kwh,
        MAX(total_energy_kwh) AS max_total_energy_kwh,
        MAX(total_energy_kwh) AS total_energy_kwh
      FROM solar_readings
      WHERE created_at >= ? AND online = 1 ${ipFilter}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `, params);

    const points = rows.map((row) => historyPoint(row, bucket));

    return {
      range,
      bucket,
      points,
      summary: {
        samples: points.reduce((total, point) => total + point.samples, 0),
        generatedEnergyKwh: round(points.reduce((total, point) => total + point.generatedEnergyKwh, 0), 3),
        maxPowerW: Math.max(0, ...points.map((point) => point.maxPowerW || 0)),
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  private recordLoggerReading(logger: SolarLogger, rawValues: Record<string, string>): void {
    if (!logger.online || !hasLoggerMetric(logger)) return;

    const previous = this.storage.get<{ created_at: string }>(
      'SELECT created_at FROM solar_readings WHERE ip = ? ORDER BY created_at DESC LIMIT 1',
      [logger.ip],
    );

    if (previous && Date.now() - Date.parse(previous.created_at) < SOLAR_READING_MIN_INTERVAL_MS) return;

    this.storage.run(
      `
      INSERT INTO solar_readings (
        ip, mac, serial, logger_serial, current_power_w, today_energy_kwh,
        total_energy_kwh, signal_percent, online, error, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        logger.ip,
        logger.mac,
        logger.serial,
        logger.loggerSerial,
        logger.currentPowerW,
        logger.todayEnergyKwh,
        logger.totalEnergyKwh,
        logger.signalPercent,
        logger.online ? 1 : 0,
        logger.error,
        this.storage.jsonDump(rawValues),
        logger.fetchedAt,
      ],
    );
  }
}

function hasLoggerMetric(logger: SolarLogger): boolean {
  return Number.isFinite(logger.currentPowerW)
    || Number.isFinite(logger.todayEnergyKwh)
    || Number.isFinite(logger.totalEnergyKwh);
}

function solarHistoryRange(value: string | undefined): SolarHistoryRange {
  if (value === '24h' || value === '7d' || value === '30d' || value === '90d') return value;
  return '7d';
}

function solarHistoryBucket(value: string | undefined, range: SolarHistoryRange): SolarHistoryBucket {
  if (value === 'hour' || value === 'day') return value;
  return range === '24h' || range === '7d' ? 'hour' : 'day';
}

function solarHistoryRangeMs(range: SolarHistoryRange): number {
  if (range === '24h') return 24 * 60 * 60_000;
  if (range === '30d') return 30 * 24 * 60 * 60_000;
  if (range === '90d') return 90 * 24 * 60 * 60_000;
  return 7 * 24 * 60 * 60_000;
}

function historyPoint(row: SolarHistoryRow, bucket: SolarHistoryBucket) {
  const minTotal = nullableNumber(row.min_total_energy_kwh);
  const maxTotal = nullableNumber(row.max_total_energy_kwh);
  const minToday = nullableNumber(row.min_today_energy_kwh);
  const maxToday = nullableNumber(row.max_today_energy_kwh);
  const totalDelta = minTotal !== null && maxTotal !== null ? maxTotal - minTotal : null;
  const todayDelta = minToday !== null && maxToday !== null ? maxToday - minToday : null;
  const generatedEnergyKwh = bucket === 'day' && maxToday !== null
    ? maxToday
    : positiveOrZero(totalDelta ?? todayDelta ?? 0);

  return {
    bucketStart: row.bucket_start,
    samples: Number(row.samples || 0),
    avgPowerW: round(nullableNumber(row.avg_power_w) || 0, 1),
    maxPowerW: round(nullableNumber(row.max_power_w) || 0, 1),
    generatedEnergyKwh: round(generatedEnergyKwh, 3),
    totalEnergyKwh: round(nullableNumber(row.total_energy_kwh) || 0, 3),
  };
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveOrZero(value: number): number {
  return value > 0 ? value : 0;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isSolarLogger(saved: SavedDiscoveryDevice): boolean {
  const device = saved.device;
  const ports = new Set(device.openPorts || []);
  const label = String(device.identification?.label || '').toLowerCase();

  return Boolean(device.ip) && (
    device.deviceType === 'solar_inverter'
    || ports.has(8899)
    || (label.includes('logger') && label.includes('solar'))
  );
}

function basicAuthorization(): string {
  const username = process.env.LOCAL_SOLAR_LOGGER_USERNAME || 'admin';
  const password = process.env.LOCAL_SOLAR_LOGGER_PASSWORD || 'admin';
  return Buffer.from(`${username}:${password}`).toString('base64');
}

function parseVariables(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  const variablePattern = /var\s+([A-Za-z0-9_]+)\s*=\s*"([^"]*)";/g;

  for (const match of html.matchAll(variablePattern)) values[match[1]] = match[2];

  return values;
}

async function fetchLoggerVariables(
  ip: string,
  authorization: string,
  cachedValues?: Record<string, string>,
): Promise<Record<string, string>> {
  if (isLoggerVariables(cachedValues)) return cachedValues;

  let lastValues: Record<string, string> = {};
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`http://${ip}/status.html`, {
        headers: { Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      lastValues = parseVariables(await response.text());
      if (isLoggerVariables(lastValues)) return lastValues;
    } catch (error) {
      lastError = error;
    }

    if (attempt === 0) await delay(250);
  }

  if (Object.keys(lastValues).length) return lastValues;
  throw lastError instanceof Error ? lastError : new Error('Logger local não respondeu.');
}

async function probeLoggerHost(ip: string, authorization: string): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(`http://${ip}/status.html`, {
      headers: { Authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(1_500),
    });

    if (!response.ok) return null;

    const values = parseVariables(await response.text());
    return isLoggerVariables(values) ? values : null;
  } catch {
    return null;
  }
}

function isLoggerVariables(values?: Record<string, string>): values is Record<string, string> {
  if (!values) return false;
  return Boolean(clean(values.cover_mid) || clean(values.webdata_sn) || numberValue(values.webdata_total_e) !== null);
}

function loggerSubnetPrefixes(): string[] {
  const envPrefixes = String(process.env.LOCAL_SOLAR_SUBNET_PREFIX || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value));

  if (envPrefixes.length) return [...new Set(envPrefixes)];

  const prefixes = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const octets = String(address.address || '').split('.');
      if (octets.length !== 4) continue;
      if (!isPrivateIpv4(address.address)) continue;
      prefixes.add(octets.slice(0, 3).join('.'));
    }
  }

  return [...prefixes];
}

function isPrivateIpv4(value: string): boolean {
  return value.startsWith('10.')
    || value.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });

  await Promise.all(runners);
}

function sortCandidates(candidates: SolarCandidate[]): SolarCandidate[] {
  return [...candidates].sort((left, right) => compareIp(left.ip, right.ip));
}

function sortIps(ips: string[]): string[] {
  return [...ips].sort(compareIp);
}

function compareIp(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));

  for (let index = 0; index < 4; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) return delta;
  }

  return 0;
}

function clean(value: string | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function numberValue(value: string | undefined): number | null {
  const parsed = Number.parseFloat(String(value || '').replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(loggers: SolarLogger[], key: 'currentPowerW' | 'todayEnergyKwh' | 'totalEnergyKwh'): number {
  return loggers.reduce((total, logger) => total + (logger[key] || 0), 0);
}

function delay(timeoutMs: number) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
