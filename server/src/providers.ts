import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  IntegrationStatus,
  IntegrationType,
  JsonObject,
  ProviderDefinition,
  ProviderDevice,
  ProviderEntity,
  StoredIntegration,
} from './types';

const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const TUYA_BOOLEAN_PRIORITY = ['switch_led', 'switch_1', 'switch', 'switch_2', 'switch_3', 'switch_4', 'switch_usb1', 'switch_usb2'];
const TUYA_REGIONS = [
  { key: 'eastern-america', label: 'Eastern America', baseUrl: 'https://openapi-ueaz.tuyaus.com' },
  { key: 'western-america', label: 'Western America', baseUrl: 'https://openapi.tuyaus.com' },
  { key: 'central-europe', label: 'Central Europe', baseUrl: 'https://openapi.tuyaeu.com' },
  { key: 'western-europe', label: 'Western Europe', baseUrl: 'https://openapi-weaz.tuyaeu.com' },
  { key: 'india', label: 'India', baseUrl: 'https://openapi.tuyain.com' },
  { key: 'china', label: 'China', baseUrl: 'https://openapi.tuyacn.com' },
];
const SECRET_FIELDS: Partial<Record<IntegrationType, Set<string>>> = {
  tuya_cloud: new Set(['accessSecret']),
  smartthings_cloud: new Set(['token']),
  tuya_local: new Set(['localKey']),
};

@Injectable()
export class ProvidersService {
  listProviderDefinitions(): ProviderDefinition[] {
    return [
      {
        type: 'tuya_cloud',
        name: 'Tuya Cloud',
        description: 'Importa devices da conta Tuya/Smart Life e localKey quando a API disponibilizar.',
        fields: [
          { key: 'accessId', label: 'Access ID', required: true },
          { key: 'accessSecret', label: 'Access Secret', required: true, secret: true },
          {
            key: 'region',
            label: 'Regiao',
            default: 'auto',
            help: 'auto, eastern-america, western-america, central-europe, western-europe, india, china',
          },
        ],
      },
      {
        type: 'smartthings_cloud',
        name: 'SmartThings',
        description: 'Importa devices e capabilities pela API cloud da SmartThings.',
        fields: [{ key: 'token', label: 'Personal Access Token', required: true, secret: true }],
      },
      {
        type: 'intelbras_izy_tuya',
        name: 'Intelbras Izy',
        description: 'Provider para devices Izy compatíveis com Tuya LAN/Cloud.',
        fields: [{ key: 'mode', label: 'Modo', default: 'tuya_compatible' }],
      },
      {
        type: 'persiana_custom',
        name: 'Persiana Custom',
        description: 'Provider local para a persiana fabricada em casa.',
        fields: [
          { key: 'baseUrl', label: 'Base URL', required: true },
          { key: 'roomHint', label: 'Comodo sugerido' },
        ],
      },
      {
        type: 'generic_iot',
        name: 'Generic IoT',
        description: 'Cadastro de device HTTP/local simples quando ainda nao existe provider dedicado.',
        fields: [
          { key: 'baseUrl', label: 'Base URL' },
          { key: 'ip', label: 'IP' },
          { key: 'deviceType', label: 'Tipo', default: 'iot' },
        ],
      },
      { type: 'esphome', name: 'ESPHome', description: 'Provider reservado para ESPHome local.', status: 'planned' },
      { type: 'onvif_camera', name: 'ONVIF Camera', description: 'Provider reservado para cameras ONVIF/RTSP.', status: 'planned' },
      { type: 'mqtt', name: 'MQTT', description: 'Provider reservado para entidades via broker MQTT.', status: 'planned' },
    ];
  }

  splitProviderConfig(providerType: IntegrationType, config: JsonObject): [JsonObject, JsonObject] {
    const secrets: JsonObject = {};
    const publicConfig: JsonObject = {};
    const secretFields = SECRET_FIELDS[providerType] || new Set<string>();
    for (const [key, value] of Object.entries(config || {})) {
      if (secretFields.has(key)) secrets[key] = value;
      else publicConfig[key] = value;
    }
    return [publicConfig, secrets];
  }

  async testProvider(integration: StoredIntegration): Promise<{ ok: boolean; status: IntegrationStatus; message: string; details?: JsonObject }> {
    try {
      if (integration.type === 'tuya_cloud') {
        const [, region] = await this.tuyaGetTokenForIntegration(integration);
        return { ok: true, status: 'connected', message: `Tuya conectada em ${region.label}.` };
      }
      if (integration.type === 'smartthings_cloud') {
        const devices = await this.smartthingsRequest(integration, '/v1/devices');
        return { ok: true, status: 'connected', message: 'SmartThings conectado.', details: { count: (devices.items || []).length } };
      }
      if (integration.type === 'persiana_custom' || integration.type === 'generic_iot') {
        return this.testHttpLikeProvider(integration);
      }
      if (integration.type === 'intelbras_izy_tuya') {
        return { ok: true, status: 'connected', message: 'Izy configurado como Tuya-compatible.' };
      }
      return { ok: true, status: 'created', message: 'Provider registrado; sync ainda nao implementado.' };
    } catch (error) {
      return { ok: false, status: 'error', message: messageFrom(error) };
    }
  }

  async syncProvider(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    if (integration.type === 'tuya_cloud') return this.syncTuyaCloud(integration);
    if (integration.type === 'smartthings_cloud') return this.syncSmartthings(integration);
    if (integration.type === 'persiana_custom' || integration.type === 'generic_iot') return [[this.deviceFromHttpLikeProvider(integration)], {}];
    if (integration.type === 'intelbras_izy_tuya') {
      return [[], { note: 'Use discovery LAN para achar Tuya 6667/6668 e Tuya Cloud para obter nomes/localKey.' }];
    }
    return [[], { note: 'Provider planejado.' }];
  }

  async sendTuyaDeviceCommands(integration: StoredIntegration, deviceId: string, commands: JsonObject[]) {
    const [token, region] = await this.tuyaGetTokenForIntegration(integration);
    const response = await this.tuyaRequest(integration, region, 'POST', `/v1.0/iot-03/devices/${deviceId}/commands`, {}, { commands }, token);
    if (!response.success) throw new Error(response.msg || 'Falha ao enviar comando Tuya.');
    return { region: region.key, response };
  }

  async sendSmartthingsDeviceCommands(integration: StoredIntegration, deviceId: string, commands: JsonObject[]) {
    const response = await this.smartthingsRequest(integration, `/v1/devices/${deviceId}/commands`, 'POST', { commands });
    return { response };
  }

  async getSmartthingsDeviceStatus(integration: StoredIntegration, deviceId: string) {
    const rawStatus = await this.smartthingsRequest(integration, `/v1/devices/${deviceId}/status`);
    return { rawStatus, statusSummary: smartthingsStatusSummary(rawStatus) };
  }

  async httpJson(method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<JsonObject> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as JsonObject;
      } catch {
        return { raw: text };
      }
    } catch (error) {
      throw new Error(messageFrom(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async syncTuyaCloud(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const [token, region] = await this.tuyaGetTokenForIntegration(integration);
    const devices: JsonObject[] = [];
    let hasMore = true;
    let lastRowKey = '';
    let total = 0;

    while (hasMore) {
      const response = await this.tuyaRequest(
        integration,
        region,
        'GET',
        '/v1.0/iot-01/associated-users/devices',
        { last_row_key: lastRowKey, size: '100' },
        undefined,
        token,
      );
      if (!response.success) throw new Error(response.msg || 'Falha ao listar devices Tuya.');
      const result = response.result || {};
      devices.push(...(result.devices || []));
      hasMore = Boolean(result.has_more);
      lastRowKey = result.last_row_key || '';
      total = result.total || devices.length;
      if (hasMore && !lastRowKey) break;
    }

    return [devices.map((device) => normalizeTuyaDevice(device, region)), { region: region.key, total }];
  }

  private async tuyaGetTokenForIntegration(integration: StoredIntegration): Promise<[string, (typeof TUYA_REGIONS)[number]]> {
    const regions = tuyaRegionsFor(String(integration.config.region || integration.config.regionKey || 'auto'));
    let lastError = 'Tuya recusou a autenticacao.';
    for (const region of regions) {
      const response = await this.tuyaRequest(integration, region, 'GET', '/v1.0/token', { grant_type: '1' });
      if (response.success && response.result?.access_token) return [response.result.access_token, region];
      lastError = response.msg || lastError;
    }
    throw new Error(lastError);
  }

  private async tuyaRequest(
    integration: StoredIntegration,
    region: (typeof TUYA_REGIONS)[number],
    method: string,
    path: string,
    query: Record<string, string> = {},
    body?: JsonObject,
    accessToken?: string,
  ): Promise<JsonObject> {
    const accessId = String(integration.config.accessId || '').trim();
    const accessSecret = String(integration.secrets.accessSecret || '').trim();
    if (!accessId || !accessSecret) throw new Error('Access ID e Access Secret da Tuya sao obrigatorios.');

    const queryEntries = Object.entries(query)
      .map(([key, value]) => [key, String(value)])
      .filter(([, value]) => value !== '')
      .sort(([left], [right]) => left.localeCompare(right));
    const queryString = new URLSearchParams(queryEntries as string[][]).toString();
    const canonicalPath = queryString ? `${path}?${queryString}` : path;
    const bodyString = body ? JSON.stringify(body) : '';
    const bodyHash = bodyString ? sha256(bodyString) : EMPTY_BODY_SHA256;
    const stringToSign = [method, bodyHash, '', canonicalPath].join('\n');
    const timestamp = String(Date.now());
    const nonce = randomUUID().replaceAll('-', '');
    const signingPayload = `${accessId}${accessToken || ''}${timestamp}${nonce}${stringToSign}`;
    const sign = createHmac('sha256', accessSecret).update(signingPayload).digest('hex').toUpperCase();
    const headers: Record<string, string> = {
      client_id: accessId,
      nonce,
      sign,
      sign_method: 'HMAC-SHA256',
      t: timestamp,
    };
    if (accessToken) headers.access_token = accessToken;
    if (bodyString) headers['Content-Type'] = 'application/json';
    return this.httpJson(method, `${region.baseUrl}${canonicalPath}`, headers, bodyString || undefined);
  }

  private async syncSmartthings(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const response = await this.smartthingsRequest(integration, '/v1/devices');
    const devices = response.items || [];
    const normalized: ProviderDevice[] = [];
    for (const device of devices) {
      const deviceId = String(device.deviceId || '').trim();
      let status: JsonObject = {};
      if (deviceId) {
        try {
          status = await this.smartthingsRequest(integration, `/v1/devices/${deviceId}/status`);
        } catch (error) {
          status = { error: messageFrom(error) };
        }
      }
      normalized.push(normalizeSmartthingsDevice(device, status));
    }
    return [normalized, { total: devices.length }];
  }

  private async smartthingsRequest(integration: StoredIntegration, path: string, method = 'GET', body?: JsonObject): Promise<JsonObject> {
    const token = String(integration.secrets.token || '').trim();
    if (!token) throw new Error('Token SmartThings obrigatorio.');
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const bodyString = body ? JSON.stringify(body) : undefined;
    if (bodyString) headers['Content-Type'] = 'application/json';
    return this.httpJson(method, `https://api.smartthings.com${path}`, headers, bodyString);
  }

  private async testHttpLikeProvider(integration: StoredIntegration) {
    const baseUrl = String(integration.config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) return { ok: false, status: 'error' as IntegrationStatus, message: 'baseUrl obrigatoria.' };
    try {
      await this.httpJson('GET', `${baseUrl}/health`);
      return { ok: true, status: 'connected' as IntegrationStatus, message: 'Endpoint respondeu /health.' };
    } catch {
      return { ok: true, status: 'connected' as IntegrationStatus, message: 'Provider salvo; /health nao respondeu, mas pode usar comandos configurados.' };
    }
  }

  private deviceFromHttpLikeProvider(integration: StoredIntegration): ProviderDevice {
    const baseUrl = String(integration.config.baseUrl || '').replace(/\/+$/, '');
    const deviceType = String(integration.config.deviceType || (integration.type === 'persiana_custom' ? 'cover' : 'iot'));
    const commandSchema = deviceType === 'cover' ? { commands: ['open', 'close', 'stop', 'set_position'] } : { commands: ['custom'] };
    return {
      externalId: baseUrl || `integration:${integration.id}`,
      name: integration.name,
      provider: integration.type,
      deviceType,
      ip: integration.config.ip,
      localDeviceKey: baseUrl ? `http:${baseUrl}` : null,
      capabilities: { baseUrl },
      status: {},
      payload: { baseUrl },
      entities: [{ key: 'main', type: deviceType, name: integration.name, commandSchema, capabilities: { baseUrl } }],
    };
  }
}

function normalizeTuyaDevice(device: JsonObject, region: (typeof TUYA_REGIONS)[number]): ProviderDevice {
  const status = Array.isArray(device.status) ? device.status : [];
  const switchCode = primarySwitchCode(status);
  const switchCodes = switchCodesFrom(status);
  const kind = inferTuyaKind(device, switchCode);
  const localKey = String(device.local_key || '').trim() || null;
  const ip = String(device.last_ip || device.ip || '').trim() || null;
  const externalId = String(device.id || device.dev_id || '').trim();
  const name = String(device.name || device.product_name || 'Dispositivo Tuya').trim();
  const entityType = kind === 'light' ? 'light' : kind === 'switch' ? 'switch' : kind === 'sensor' ? 'sensor' : kind;
  const entities: ProviderEntity[] = switchCodes.map((code, index) => ({
    key: code,
    type: entityType,
    name: switchCodes.length === 1 ? name : `${name} ${index + 1}`,
    commandSchema: { commands: ['turn_on', 'turn_off', 'toggle'], switchCode: code },
    state: { online: device.online, status },
    capabilities: { status },
  }));

  return {
    externalId,
    name,
    provider: 'tuya_cloud',
    deviceType: kind,
    manufacturer: 'Tuya',
    model: String(device.model || '').trim() || null,
    ip,
    productKey: String(device.product_key || device.productKey || '').trim() || null,
    localDeviceKey: `tuya:${externalId}`,
    capabilities: { category: device.category, primarySwitchCode: switchCode, status },
    status: { online: device.online, state: inferTuyaState(status, device.online, switchCode, kind) },
    payload: {
      category: device.category,
      productName: device.product_name,
      regionKey: region.key,
      regionLabel: region.label,
      raw: Object.fromEntries(Object.entries(device).filter(([key]) => key !== 'local_key')),
    },
    secrets: localKey ? { localKey } : {},
    entities,
  };
}

function normalizeSmartthingsDevice(device: JsonObject, status: JsonObject = {}): ProviderDevice {
  const externalId = String(device.deviceId || '').trim();
  const label = device.label || device.name || 'Dispositivo SmartThings';
  const components = Array.isArray(device.components) ? device.components : [];
  const capabilities = components.flatMap((component: JsonObject) => (component.capabilities || []).map((capability: JsonObject) => capability.id));
  const statusSummary = smartthingsStatusSummary(status);
  const kind = inferSmartthingsKind(device, capabilities);
  return {
    externalId,
    name: label,
    provider: 'smartthings_cloud',
    deviceType: kind,
    manufacturer: device.manufacturerName,
    model: device.deviceManufacturerCode || device.mnmn,
    capabilities: { capabilities, components, status },
    status: statusSummary,
    payload: { raw: device, status },
    entities: [{ key: 'main', type: kind, name: label, commandSchema: { capabilities }, state: statusSummary, capabilities: { components, status } }],
  };
}

export function smartthingsStatusSummary(status: JsonObject): JsonObject {
  const main = status?.components?.main || {};
  const switchValue = nested(main, 'switch', 'switch', 'value');
  const health = nested(main, 'healthCheck', 'healthStatus', 'value') || nested(main, 'healthCheck', 'DeviceWatch-DeviceStatus', 'value');
  const online = typeof health === 'string' ? ['online', 'healthy'].includes(health.toLowerCase()) : true;
  let state = 'unknown';
  if (typeof switchValue === 'string') state = switchValue.toLowerCase();
  else if (online === false) state = 'off';
  return { online, state, raw: status };
}

function inferSmartthingsKind(device: JsonObject, capabilities: any[]): string {
  const text = ['deviceTypeName', 'presentationId', 'label', 'name', 'manufacturerName'].map((key) => String(device[key] || '')).join(' ').toLowerCase();
  const categories = new Set<string>();
  for (const component of device.components || []) {
    for (const category of component.categories || []) {
      if (category && typeof category === 'object') categories.add(String(category.name || '').toLowerCase());
    }
  }
  const capabilitySet = new Set(capabilities.map(String));
  if (categories.has('airconditioner') || text.includes('air conditioner') || text.includes('airconditioner') || capabilitySet.has('airConditionerMode')) return 'climate';
  if (capabilitySet.has('thermostat') || capabilitySet.has('thermostatCoolingSetpoint') || capabilitySet.has('thermostatHeatingSetpoint')) return 'climate';
  if (categories.has('light') || capabilitySet.has('switchLevel') || capabilitySet.has('colorControl')) return 'light';
  if (capabilitySet.has('switch')) return 'switch';
  return 'sensor';
}

function primarySwitchCode(status: JsonObject[]): string | null {
  for (const code of TUYA_BOOLEAN_PRIORITY) {
    if (status.some((entry) => entry.code === code && typeof entry.value === 'boolean')) return code;
  }
  for (const entry of status) {
    const code = String(entry.code || '');
    if (code.startsWith('switch') && typeof entry.value === 'boolean') return code;
  }
  const firstBoolean = status.find((entry) => typeof entry.value === 'boolean');
  return firstBoolean ? String(firstBoolean.code) : null;
}

function switchCodesFrom(status: JsonObject[]): string[] {
  const codes = status.filter((entry) => String(entry.code || '').startsWith('switch_') && typeof entry.value === 'boolean').map((entry) => String(entry.code));
  if (codes.length) return codes;
  const primary = primarySwitchCode(status);
  return primary ? [primary] : [];
}

function inferTuyaKind(device: JsonObject, switchCode: string | null): string {
  const text = ['category', 'product_name', 'model', 'name'].map((key) => String(device[key] || '')).join(' ').toLowerCase();
  const codes = new Set<string>((device.status || []).map((entry: JsonObject) => String(entry.code || '').toLowerCase()));
  if (['feeder', 'alimentador', 'pet feeder'].some((term) => text.includes(term)) || codes.has('manual_feed') || codes.has('feed_state')) return 'FEEDER';
  if (['camera', 'cam', 'ipc'].some((term) => text.includes(term))) return 'camera';
  if (['curtain', 'cover', 'persiana', 'cortina'].some((term) => text.includes(term))) return 'cover';
  if (['alarm', 'siren', 'alarme'].some((term) => text.includes(term))) return 'alarm';
  if (intersects(codes, ['bright', 'bright_value', 'bright_value_v2', 'colour_data', 'colour_data_v2', 'temp_value', 'temp_value_v2', 'work_mode'])) return 'light';
  if (intersects(codes, ['va_battery', 'battery_state', 'battery_percentage', 'doorcontact_state', 'pir', 'smoke_sensor_state', 'temp_current', 'humidity_value'])) return 'sensor';
  if (switchCode) return ['lamp', 'luz', 'ews410'].some((term) => text.includes(term)) ? 'light' : 'switch';
  return 'iot';
}

function inferTuyaState(status: JsonObject[], online: boolean | null | undefined, switchCode: string | null, kind: string): string {
  if (switchCode) {
    const entry = status.find((item) => item.code === switchCode && typeof item.value === 'boolean');
    if (entry) return entry.value ? 'on' : 'off';
  }
  if (online === false) return 'off';
  return ['sensor', 'alarm'].includes(kind) ? 'idle' : 'unknown';
}

function tuyaRegionsFor(regionKey: string) {
  if (regionKey === 'auto') return TUYA_REGIONS;
  return TUYA_REGIONS.filter((region) => region.key === regionKey);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function intersects(values: Set<string>, options: string[]): boolean {
  return options.some((option) => values.has(option));
}

function nested(value: JsonObject, ...keys: string[]) {
  let current: any = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
