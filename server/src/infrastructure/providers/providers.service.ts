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
} from '../../types';
import { MqttConnectionOptions, MqttMessage, MqttService } from '../mqtt/mqtt.service';
import { StorageService } from '../storage/storage.service';
import { DiscoveryService } from '../discovery/discovery-runner.service';
import { Amt8000Client, Amt8000Status } from './amt8000.client';
import { CameraProbeResult, OnvifCameraClient } from './onvif-camera.client';

const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SMARTTHINGS_API_BASE_URL = 'https://api.smartthings.com';
const SMARTTHINGS_TOKEN_URL = `${SMARTTHINGS_API_BASE_URL}/oauth/token`;
const SMARTTHINGS_REFRESH_SKEW_MS = 5 * 60 * 1000;
const SOLARMAN_API_BASE_URL = 'https://globalapi.solarmanpv.com';
const MQTT_DEFAULT_DISCOVERY_PREFIX = 'homeassistant';
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
  smartthings_cloud: new Set(['token', 'accessToken', 'refreshToken', 'clientId', 'clientSecret', 'tokenType', 'expiresAt', 'expiresIn', 'scope']),
  mqtt: new Set(['username', 'password']),
  tuya_local: new Set(['localKey']),
  intelbras_amt8000: new Set(['password']),
  intelbras_solar: new Set(['appSecret', 'password']),
  onvif_camera: new Set(['username', 'password']),
};

@Injectable()
export class ProvidersService {
  constructor(
    private readonly storage: StorageService,
    private readonly mqtt: MqttService,
    private readonly discovery: DiscoveryService,
  ) { }

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
        description: 'Importa devices e capabilities pela API cloud da SmartThings via OAuth 2.0.',
        fields: [],
      },
      {
        type: 'intelbras_izy_tuya',
        name: 'Intelbras Izy',
        description: 'Provider para devices Izy compatíveis com Tuya LAN/Cloud.',
        fields: [{ key: 'mode', label: 'Modo', default: 'tuya_compatible' }],
      },
      {
        type: 'intelbras_amt8000',
        name: 'Intelbras AMT 8000',
        description: 'Le status, particoes e zonas da central local via ISECNet v2.',
        fields: [
          { key: 'ip', label: 'IP', required: true },
          { key: 'port', label: 'Porta', required: true, default: 9009 },
          { key: 'password', label: 'Senha da central', required: true, secret: true },
        ],
      },
      {
        type: 'intelbras_solar',
        name: 'Intelbras Solar Send',
        description: 'Importa microinversores Intelbras e leituras dos modulos pela API Solarman.',
        fields: [
          { key: 'appId', label: 'Solarman App ID', required: true },
          { key: 'appSecret', label: 'Solarman App Secret', required: true, secret: true },
          { key: 'email', label: 'E-mail da conta', required: true },
          { key: 'password', label: 'Senha da conta', required: true, secret: true },
          { key: 'moduleCount', label: 'Quantidade de modulos', default: 4 },
        ],
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
      {
        type: 'onvif_camera',
        name: 'Cameras ONVIF/RTSP',
        description: 'Busca cameras IP na rede local e conecta aos streams RTSP.',
        fields: [
          { key: 'subnetPrefix', label: 'Sub-rede', help: 'Ex: 192.168.1' },
        ],
      },
      {
        type: 'mqtt',
        name: 'MQTT',
        description: 'Importa dispositivos via MQTT Discovery e envia comandos pelo broker.',
        fields: [
          { key: 'brokerUrl', label: 'Broker URL', default: process.env.MQTT_URL || 'mqtt://localhost:1883', help: 'Ex: mqtt://localhost:1883' },
          { key: 'username', label: 'Usuario', secret: true },
          { key: 'password', label: 'Senha', secret: true },
          { key: 'discoveryPrefix', label: 'Discovery prefix', default: MQTT_DEFAULT_DISCOVERY_PREFIX },
        ],
      },
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
      if (integration.type === 'mqtt') {
        await this.mqtt.testConnection(this.mqttConnectionOptions(integration));
        return { ok: true, status: 'connected', message: 'Broker MQTT conectado.' };
      }
      if (integration.type === 'persiana_custom' || integration.type === 'generic_iot') {
        return this.testHttpLikeProvider(integration);
      }
      if (integration.type === 'intelbras_izy_tuya') {
        return { ok: true, status: 'connected', message: 'Izy configurado como Tuya-compatible.' };
      }
      if (integration.type === 'intelbras_amt8000') {
        const panelStatus = await this.amt8000Client(integration).getStatus();
        return {
          ok: true,
          status: 'connected',
          message: 'Central Intelbras AMT 8000 conectada.',
          details: {
            model: panelStatus.model,
            version: panelStatus.version,
            partitions: panelStatus.partitions.filter((partition) => partition.index > 0).length,
            zones: panelStatus.zones.length,
          },
        };
      }
      if (integration.type === 'intelbras_solar') {
        const token = await this.solarmanAccessToken(integration);
        const stations = await this.solarmanRequest(integration, token, '/station/v1.0/list', {});
        const stationList = solarmanList(stations, 'stationList');
        return {
          ok: true,
          status: 'connected',
          message: `Intelbras Solar Send conectado. ${stationList.length} planta(s) encontrada(s).`,
          details: { stations: stationList.length },
        };
      }
      if (integration.type === 'onvif_camera') {
        const cameras = await this.discoverCameras(integration);
        return {
          ok: true,
          status: 'connected',
          message: `${cameras.length} camera(s) RTSP encontrada(s) na rede.`,
          details: { cameras: cameras.length },
        };
      }
      return { ok: true, status: 'created', message: 'Provider registrado; sync ainda nao implementado.' };
    } catch (error) {
      return { ok: false, status: 'error', message: messageFrom(error) };
    }
  }

  async syncProvider(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    if (integration.type === 'tuya_cloud') return this.syncTuyaCloud(integration);
    if (integration.type === 'smartthings_cloud') return this.syncSmartthings(integration);
    if (integration.type === 'mqtt') return this.syncMqtt(integration);
    if (integration.type === 'intelbras_amt8000') return this.syncAmt8000(integration);
    if (integration.type === 'intelbras_solar') return this.syncIntelbrasSolar(integration);
    if (integration.type === 'onvif_camera') return this.syncOnvifCameras(integration);
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

  async getTuyaDeviceStatus(integration: StoredIntegration, deviceId: string) {
    const [token, region] = await this.tuyaGetTokenForIntegration(integration);
    const response = await this.tuyaRequest(integration, region, 'GET', `/v1.0/devices/${deviceId}`, {}, undefined, token);
    if (!response.success) throw new Error(response.msg || 'Falha ao consultar status Tuya.');
    const rawStatus = response.result && typeof response.result === 'object' && !Array.isArray(response.result) ? response.result : {};
    const normalized = normalizeTuyaDevice(rawStatus, region);
    const safeRawStatus = Object.fromEntries(Object.entries(rawStatus).filter(([key]) => key !== 'local_key'));
    return {
      rawStatus: safeRawStatus,
      statusEntries: Array.isArray(rawStatus.status) ? rawStatus.status : [],
      statusSummary: normalized.status,
    };
  }

  async sendSmartthingsDeviceCommands(integration: StoredIntegration, deviceId: string, commands: JsonObject[]) {
    const response = await this.smartthingsRequest(integration, `/v1/devices/${deviceId}/commands`, 'POST', { commands });
    return { response };
  }

  async getSmartthingsDeviceStatus(integration: StoredIntegration, deviceId: string) {
    const rawStatus = await this.smartthingsRequest(integration, `/v1/devices/${deviceId}/status`);
    return { rawStatus, statusSummary: smartthingsStatusSummary(rawStatus) };
  }

  async getIntelbrasSolarDeviceStatus(integration: StoredIntegration, deviceSn: string, deviceId?: number | string) {
    const token = await this.solarmanAccessToken(integration);
    const rawStatus = await this.solarmanRequest(integration, token, '/device/v1.0/currentData', {
      deviceSn,
      ...(deviceId ? { deviceId: Number(deviceId) } : {}),
    });
    return {
      rawStatus,
      statusSummary: solarmanStatusSummary(rawStatus),
      metrics: solarmanMetrics(rawStatus),
    };
  }

  async getOnvifCameraStatus(integration: StoredIntegration, ip: string, port: number, path: string, credentials: JsonObject = {}) {
    const client = this.cameraClient(integration, ip, port, path, credentials);
    const probe = await client.probe();
    const ptz = probe.authenticated ? await client.probePtz() : { available: false, error: 'Autenticacao obrigatoria para detectar PTZ.' };
    return {
      probe: { ...probe, ptzAvailable: ptz.available, ptzError: ptz.error || null },
      statusSummary: {
        online: probe.online,
        state: probe.streamAvailable ? 'streaming' : probe.online ? 'idle' : 'offline',
        authenticated: probe.authenticated,
        streamAvailable: probe.streamAvailable,
        ptzAvailable: ptz.available,
        ptzError: ptz.error || null,
      },
    };
  }

  async controlOnvifCameraPtz(integration: StoredIntegration, ip: string, port: number, path: string, credentials: JsonObject, params: JsonObject) {
    const client = this.cameraClient(integration, ip, port, path, credentials);
    if (params.stop === true) await client.stopPtz();
    else await client.movePtz(Number(params.pan || 0), Number(params.tilt || 0), Number(params.zoom || 0), Number(params.durationMs || 350));
    return { ptzAvailable: true };
  }

  async publishMqttCommand(integration: StoredIntegration, topic: string, payload: unknown, retain = false) {
    await this.mqtt.publish(this.mqttConnectionOptions(integration), topic, payload, retain);
    return { topic, payload, retain };
  }

  async collectMqttMessages(integration: StoredIntegration, topic: string, waitMs = 800): Promise<MqttMessage[]> {
    return this.mqtt.collectMessages(this.mqttConnectionOptions(integration), topic, waitMs);
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

  private async syncMqtt(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const discoveryPrefix = String(integration.config.discoveryPrefix || MQTT_DEFAULT_DISCOVERY_PREFIX).replace(/^\/+|\/+$/g, '');
    const scanMs = Math.min(15_000, Math.max(1_000, Number(integration.config.scanMs || integration.config.scanSeconds || 4) * 1000));
    const messages = await this.mqtt.collectMessages(this.mqttConnectionOptions(integration), `${discoveryPrefix}/#`, scanMs);
    const devices = normalizeMqttDevices(messages, this.mqttBrokerUrl(integration), discoveryPrefix);
    return [devices, { total: devices.length, messages: messages.length, discoveryPrefix, scanMs }];
  }

  private async syncAmt8000(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const status = await this.amt8000Client(integration).getStatus();
    return [[normalizeAmt8000Device(integration, status)], {
      partitions: status.partitions.filter((partition) => partition.index > 0).length,
      zones: status.zones.length,
    }];
  }

  private async syncIntelbrasSolar(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const token = await this.solarmanAccessToken(integration);
    const stationResponse = await this.solarmanRequest(integration, token, '/station/v1.0/list', {});
    const stations = solarmanList(stationResponse, 'stationList');
    const devices: ProviderDevice[] = [];

    for (const station of stations) {
      const stationId = Number(station.id || station.stationId);
      if (!Number.isFinite(stationId)) continue;
      const deviceResponse = await this.solarmanRequest(integration, token, '/station/v1.0/device', { stationId, deviceType: 'INVERTER' });
      const stationDevices = solarmanList(deviceResponse, 'deviceListItems');
      for (const device of stationDevices) {
        const deviceSn = String(device.deviceSn || device.sn || '').trim();
        if (!deviceSn) continue;
        let currentData: JsonObject = {};
        try {
          currentData = await this.solarmanRequest(integration, token, '/device/v1.0/currentData', {
            deviceSn,
            ...(device.deviceId ? { deviceId: Number(device.deviceId) } : {}),
          });
        } catch (error) {
          currentData = { error: messageFrom(error) };
        }
        devices.push(normalizeIntelbrasSolarDevice(integration, station, device, currentData));
      }
    }

    return [devices, { stations: stations.length, devices: devices.length, moduleCount: solarModuleCount(integration) }];
  }

  private async syncOnvifCameras(integration: StoredIntegration): Promise<[ProviderDevice[], JsonObject]> {
    const cameras = await this.discoverCameras(integration);
    const devices: ProviderDevice[] = [];
    for (const camera of cameras) {
      const ip = String(camera.ip || '').trim();
      const port = camera.openPorts.includes(554) ? 554 : camera.openPorts.includes(8554) ? 8554 : 554;
      const path = '/cam/realmonitor?channel=1&subtype=0';
      const probe = await this.cameraClient(integration, ip, port, path).probe();
      devices.push(normalizeOnvifCamera(integration, camera, port, path, probe));
    }
    return [devices, { cameras: devices.length, subnetPrefix: integration.config.subnetPrefix || 'auto' }];
  }

  private async discoverCameras(integration: StoredIntegration) {
    const { result } = await this.discovery.scanNow({
      subnet_prefix: String(integration.config.subnetPrefix || '').trim() || undefined,
      scan_ports: true,
      timeout_seconds: Number(integration.config.timeoutSeconds || 1),
      probeMode: 'aggressive',
      ports: [80, 443, 554, 8554],
    }, { upsertInbox: false });
    return result.filter((device) => device.deviceType === 'camera' || device.openPorts.some((port) => [554, 8554].includes(port)));
  }

  private cameraClient(integration: StoredIntegration, ip: string, port: number, path: string, credentials: JsonObject = {}): OnvifCameraClient {
    return new OnvifCameraClient(
      ip,
      port,
      String(credentials.username || ''),
      String(credentials.password || ''),
      path,
      Number(integration.config.timeoutMs || 2_500),
    );
  }

  private amt8000Client(integration: StoredIntegration): Amt8000Client {
    const ip = String(integration.config.ip || '').trim();
    const port = Number(integration.config.port || 9009);
    const password = String(integration.secrets.password || '').trim();
    return new Amt8000Client(ip, port, password);
  }

  private async solarmanAccessToken(integration: StoredIntegration): Promise<string> {
    const appId = String(integration.config.appId || '').trim();
    const appSecret = String(integration.secrets.appSecret || '').trim();
    const email = String(integration.config.email || '').trim();
    const username = String(integration.config.username || '').trim();
    const password = String(integration.secrets.password || '').trim();
    if (!appId || !appSecret || (!email && !username) || !password) {
      throw new Error('App ID, App Secret, conta e senha do Solarman sao obrigatorios.');
    }
    let response: JsonObject;
    try {
      response = await this.solarmanFetch(integration, `/account/v1.0/token?appId=${encodeURIComponent(appId)}`, {
        appSecret,
        ...(email ? { email } : { username }),
        password: /^[a-f0-9]{64}$/i.test(password) ? password : sha256(password),
      });
    } catch (error) {
      throw new Error(`Falha ao autenticar na OpenAPI Solarman. Verifique App ID, App Secret, e-mail, senha e se a conta está autorizada para esse App ID. ${messageFrom(error)}`);
    }
    const token = String(response.access_token || response.accessToken || '').trim();
    if (!token) {
      throw new Error(`Falha ao autenticar na OpenAPI Solarman. Verifique se a conta está autorizada para esse App ID. ${solarmanErrorMessage(response)}`);
    }
    return token;
  }

  private async solarmanRequest(integration: StoredIntegration, token: string, path: string, body: JsonObject): Promise<JsonObject> {
    const response = await this.solarmanFetch(integration, path, body, token);
    if (response.success === false || response.code && ![0, '0'].includes(response.code)) {
      throw new Error(solarmanErrorMessage(response));
    }
    return response;
  }

  private async solarmanFetch(integration: StoredIntegration, path: string, body: JsonObject, token?: string): Promise<JsonObject> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const baseUrl = String(integration.config.apiBaseUrl || SOLARMAN_API_BASE_URL).replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(solarmanErrorMessage(data, `Solarman HTTP ${response.status}.`));
      return data;
    } catch (error) {
      throw new Error(messageFrom(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private mqttConnectionOptions(integration: StoredIntegration): MqttConnectionOptions {
    return {
      brokerUrl: this.mqttBrokerUrl(integration),
      username: String(integration.secrets.username || '').trim() || null,
      password: String(integration.secrets.password || '').trim() || null,
      clientId: String(integration.config.clientId || `mini-has-${integration.id || 'setup'}`).trim(),
      connectTimeoutMs: Number(integration.config.connectTimeoutMs || 5_000),
      keepAliveSeconds: Number(integration.config.keepAliveSeconds || 30),
    };
  }

  private mqttBrokerUrl(integration: StoredIntegration): string {
    const brokerUrl = String(integration.config.brokerUrl || process.env.MQTT_URL || 'mqtt://localhost:1883').trim();
    if (!brokerUrl) throw new Error('Broker URL MQTT obrigatoria.');
    return brokerUrl;
  }

  private async smartthingsRequest(integration: StoredIntegration, path: string, method = 'GET', body?: JsonObject): Promise<JsonObject> {
    let token = await this.smartthingsAccessToken(integration);
    let response = await this.smartthingsFetch(token, path, method, body);
    if (response.status === 401 && String(integration.secrets.refreshToken || '').trim()) {
      token = await this.refreshSmartthingsAccessToken(integration);
      response = await this.smartthingsFetch(token, path, method, body);
    }
    if (!response.ok) throw new Error(smartthingsErrorMessage(response.body, response.status));
    return response.body;
  }

  private async smartthingsAccessToken(integration: StoredIntegration): Promise<string> {
    const token = String(integration.secrets.accessToken || integration.secrets.token || '').trim();
    const expiresAt = Date.parse(String(integration.secrets.expiresAt || ''));
    const shouldRefresh = Number.isFinite(expiresAt) && expiresAt <= Date.now() + SMARTTHINGS_REFRESH_SKEW_MS;
    if (token && !shouldRefresh) return token;
    if (!String(integration.secrets.refreshToken || '').trim()) {
      if (token) return token;
      throw new Error('Autenticacao OAuth da SmartThings obrigatoria.');
    }
    return this.refreshSmartthingsAccessToken(integration);
  }

  private async refreshSmartthingsAccessToken(integration: StoredIntegration): Promise<string> {
    const refreshToken = String(integration.secrets.refreshToken || '').trim();
    const clientId = String(integration.secrets.clientId || process.env.SMARTTHINGS_CLIENT_ID || '').trim();
    const clientSecret = String(integration.secrets.clientSecret || process.env.SMARTTHINGS_CLIENT_SECRET || '').trim();
    if (!refreshToken) throw new Error('Refresh token SmartThings obrigatorio.');
    if (!clientId || !clientSecret) throw new Error('SMARTTHINGS_CLIENT_ID e SMARTTHINGS_CLIENT_SECRET obrigatorios para renovar OAuth.');

    const response = await fetch(SMARTTHINGS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || !data.access_token) {
      throw new Error(smartthingsErrorMessage(data, response.status, 'Falha ao renovar token SmartThings.'));
    }

    const nextSecrets: JsonObject = {
      ...integration.secrets,
      clientId,
      clientSecret,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      tokenType: data.token_type || integration.secrets.tokenType || 'bearer',
      expiresIn: data.expires_in || integration.secrets.expiresIn,
      expiresAt: smartthingsExpiresAt(data.expires_in) || integration.secrets.expiresAt,
      scope: data.scope || integration.secrets.scope,
    };
    Object.assign(integration.secrets, nextSecrets);
    if (integration.id > 0) {
      this.storage.run('UPDATE integrations SET secrets_json = ?, updated_at = ? WHERE id = ?', [
        this.storage.jsonDump(nextSecrets),
        this.storage.utcNow(),
        integration.id,
      ]);
    }
    return String(nextSecrets.accessToken);
  }

  private async smartthingsFetch(
    token: string,
    path: string,
    method = 'GET',
    body?: JsonObject,
  ): Promise<{ ok: boolean; status: number; body: JsonObject }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const bodyString = body ? JSON.stringify(body) : undefined;
      if (bodyString) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${SMARTTHINGS_API_BASE_URL}${path}`, {
        method,
        headers,
        body: bodyString,
        signal: controller.signal,
      });
      return { ok: response.ok, status: response.status, body: await readJsonResponse(response) };
    } catch (error) {
      throw new Error(messageFrom(error));
    } finally {
      clearTimeout(timeout);
    }
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

function normalizeIntelbrasSolarDevice(
  integration: StoredIntegration,
  station: JsonObject,
  device: JsonObject,
  currentData: JsonObject,
): ProviderDevice {
  const deviceSn = String(device.deviceSn || device.sn || '').trim();
  const deviceId = Number(device.deviceId || device.id);
  const moduleCount = solarModuleCount(integration);
  const metrics = solarmanMetrics(currentData);
  const status = solarmanStatusSummary(currentData, device);
  const name = String(device.deviceName || device.name || `Microinversor ${deviceSn}`).trim();
  const entities: ProviderEntity[] = [
    {
      key: 'main',
      type: 'solar_inverter',
      name,
      commandSchema: { commands: ['query'], readOnly: true },
      state: status,
      capabilities: { readOnly: true, metrics },
    },
    ...Array.from({ length: moduleCount }, (_, index) => {
      const module = index + 1;
      const moduleMetrics = metrics.filter((metric) => solarmanMetricModule(metric) === module);
      const power = solarmanMetricNumber(moduleMetrics, ['power', 'potencia', 'pdc']);
      return {
        key: `module_${module}`,
        type: 'sensor',
        name: `Modulo solar ${module}`,
        commandSchema: { commands: ['query'], readOnly: true },
        state: { online: status.online, state: power > 0 ? 'generating' : 'idle', power, metrics: moduleMetrics },
        capabilities: { module, deviceClass: 'power', readOnly: true, metrics: moduleMetrics },
      };
    }),
  ];

  return {
    externalId: deviceSn,
    name,
    provider: 'intelbras_solar',
    deviceType: 'solar_inverter',
    manufacturer: 'Intelbras',
    model: String(device.deviceModel || device.model || 'Microinversor').trim(),
    localDeviceKey: null,
    capabilities: {
      readOnly: true,
      moduleCount,
      stationId: station.id || station.stationId,
      stationName: station.name || station.stationName,
      deviceId: Number.isFinite(deviceId) ? deviceId : null,
      metrics,
    },
    status,
    payload: {
      station,
      device,
      currentData,
      platform: 'solarman',
      cloudOnly: true,
    },
    entities,
  };
}

function normalizeOnvifCamera(
  integration: StoredIntegration,
  camera: import('../../types').DiscoveredDevice,
  port: number,
  path: string,
  probe: CameraProbeResult,
): ProviderDevice {
  const ip = String(camera.ip || '').trim();
  const externalId = String(camera.mac || ip).trim();
  const safeRtspUrl = `rtsp://${ip}:${port}${path.startsWith('/') ? path : `/${path}`}`;
  const name = camera.name && camera.name !== 'Possível câmera IP'
    ? camera.name
    : `Camera ${ip.split('.').at(-1) || externalId}`;
  const status = {
    online: probe.online,
    state: probe.streamAvailable ? 'streaming' : probe.online ? 'idle' : 'offline',
    authenticated: probe.authenticated,
    streamAvailable: probe.streamAvailable,
    error: probe.error || null,
  };
  return {
    externalId,
    name,
    provider: 'onvif_camera',
    deviceType: 'camera',
    manufacturer: camera.manufacturer || null,
    model: camera.model || probe.server || null,
    ip,
    mac: camera.mac || null,
    localDeviceKey: `rtsp:${ip}:${port}`,
    capabilities: {
      readOnly: true,
      rtspUrl: safeRtspUrl,
      rtspPort: port,
      rtspPath: path,
      onvifUrl: `http://${ip}/onvif/device_service`,
      authenticated: probe.authenticated,
      streamAvailable: probe.streamAvailable,
    },
    status,
    payload: {
      ip,
      mac: camera.mac || null,
      openPorts: camera.openPorts,
      services: camera.services,
      rtspUrl: safeRtspUrl,
      onvifUrl: `http://${ip}/onvif/device_service`,
      discovery: camera,
    },
    secrets: {},
    entities: [{
      key: 'main',
      type: 'camera',
      name,
      commandSchema: { commands: ['query'], readOnly: true },
      state: status,
      capabilities: { readOnly: true, rtspUrl: safeRtspUrl, onvifUrl: `http://${ip}/onvif/device_service` },
    }],
  };
}

function solarModuleCount(integration: StoredIntegration): number {
  const value = Number(integration.config.moduleCount || 4);
  return Number.isFinite(value) ? Math.min(16, Math.max(1, value)) : 4;
}

function solarmanList(response: JsonObject, preferredKey: string): JsonObject[] {
  const candidates = [response[preferredKey], response.list, response.items, response.data];
  return candidates.find(Array.isArray) || [];
}

function solarmanMetrics(response: JsonObject): JsonObject[] {
  return solarmanList(response, 'dataList').filter((item) => item && typeof item === 'object');
}

function solarmanStatusSummary(response: JsonObject, device: JsonObject = {}): JsonObject {
  const metrics = solarmanMetrics(response);
  const power = solarmanMetricNumber(metrics, ['pac', 'ac power', 'output power', 'potencia ativa', 'potencia de saida']);
  const todayEnergy = solarmanMetricNumber(metrics, ['e-today', 'etoday', 'daily production', 'energia diaria', 'yield today']);
  const totalEnergy = solarmanMetricNumber(metrics, ['e-total', 'etotal', 'total production', 'energia total', 'total yield']);
  const rawState = device.deviceState ?? response.deviceState ?? response.state;
  const online = rawState === undefined ? !response.error : ![3, -1, '3', '-1', 'offline'].includes(rawState);
  return {
    online,
    state: online ? (power > 0 ? 'generating' : 'idle') : 'offline',
    power,
    todayEnergy,
    totalEnergy,
    collectionTime: response.collectionTime || response.collectTime || null,
  };
}

function solarmanMetricNumber(metrics: JsonObject[], terms: string[]): number {
  const metric = metrics.find((item) => {
    const text = [item.key, item.name, item.i18nKey].filter(Boolean).join(' ').toLowerCase();
    return terms.some((term) => text === term || text.includes(term));
  });
  const value = Number(metric?.value);
  return Number.isFinite(value) ? value : 0;
}

function solarmanMetricModule(metric: JsonObject): number | null {
  const text = [metric.key, metric.name, metric.i18nKey].filter(Boolean).join(' ').toLowerCase();
  const match = text.match(/(?:pv|mppt|module|modulo|input|entrada|dc)[ _-]*0?(\d{1,2})/i);
  return match ? Number(match[1]) : null;
}

function solarmanErrorMessage(response: JsonObject, fallback = 'Falha na API Solarman.'): string {
  const message = response.msg || response.message || response.error_description || response.error || response.raw;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

function normalizeAmt8000Device(integration: StoredIntegration, status: Amt8000Status): ProviderDevice {
  const ip = String(integration.config.ip || '').trim();
  const port = Number(integration.config.port || 9009);
  const partitions = status.partitions.filter((partition) => partition.index > 0);
  const panelState = {
    online: true,
    state: status.state.toLowerCase(),
    siren: status.sirenLive,
    zonesFiring: status.zonesFiring,
    zonesClosed: status.zonesClosed,
    battery: status.battery,
    tamper: status.tamper,
    version: status.version,
  };
  const entities: ProviderEntity[] = [
    {
      key: 'main',
      type: 'alarm',
      name: integration.name,
      commandSchema: { commands: ['query', 'arm', 'disarm', 'arm_partition', 'disarm_partition'] },
      state: panelState,
      capabilities: { partitions: partitions.map((partition) => partition.index) },
    },
    {
      key: 'siren',
      type: 'binary_sensor',
      name: 'Sirene',
      commandSchema: { commands: ['query'] },
      state: { online: true, state: status.sirenLive ? 'on' : 'off', active: status.sirenLive },
      capabilities: { deviceClass: 'siren', readOnly: true },
    },
    ...partitions.map((partition) => ({
      key: `partition_${partition.index}`,
      type: 'alarm',
      name: `Particao ${partition.index}`,
      commandSchema: { commands: ['query', 'arm_partition', 'disarm_partition'], partition: partition.index },
      state: {
        online: true,
        state: partition.armed ? 'armed' : 'disarmed',
        armed: partition.armed,
        stay: partition.stay,
        firing: partition.firing,
        fired: partition.fired,
      },
      capabilities: { partition: partition.index },
    })),
    ...status.zones.map((zone) => ({
      key: `zone_${zone.number}`,
      type: 'binary_sensor',
      name: `Zona ${zone.number}`,
      commandSchema: { commands: ['query'], readOnly: true },
      state: {
        online: true,
        state: zone.open ? 'open' : 'closed',
        open: zone.open,
        violated: zone.violated,
        bypassed: zone.bypassed,
        tamper: zone.tamper,
        lowBattery: zone.lowBattery,
      },
      capabilities: { zone: zone.number, deviceClass: 'opening', readOnly: true },
    })),
  ];

  return {
    externalId: `amt8000:${ip}:${port}`,
    name: integration.name,
    provider: 'intelbras_amt8000',
    deviceType: 'alarm',
    manufacturer: 'Intelbras',
    model: `AMT 8000 (${status.model})`,
    ip,
    localDeviceKey: `isecnet:${ip}:${port}`,
    capabilities: {
      protocol: 'isecnet-v2',
      partitions: partitions.length,
      partitionIndexes: partitions.map((partition) => partition.index),
      zones: status.zones.length,
    },
    status: panelState,
    payload: {
      ip,
      port,
      protocol: 'isecnet-v2',
      model: status.model,
      version: status.version,
    },
    secrets: { password: integration.secrets.password },
    entities,
  };
}

function normalizeMqttDevices(messages: MqttMessage[], brokerUrl: string, discoveryPrefix: string): ProviderDevice[] {
  const devices = new Map<string, ProviderDevice & { entities: ProviderEntity[] }>();
  for (const message of messages) {
    const parsed = parseMqttDiscoveryMessage(message, discoveryPrefix);
    if (!parsed) continue;
    const deviceId = mqttDeviceId(parsed.config, parsed.topic);
    const deviceName = mqttDeviceName(parsed.config, parsed.objectId);
    const entityType = mqttDeviceType(parsed.component, parsed.config);
    const existing =
      devices.get(deviceId) ||
      ({
        externalId: deviceId,
        name: deviceName,
        provider: 'mqtt',
        deviceType: entityType,
        manufacturer: mqttDeviceField(parsed.config, 'manufacturer', 'mf') || null,
        model: mqttDeviceField(parsed.config, 'model', 'mdl') || null,
        localDeviceKey: `mqtt:${brokerUrl}:${deviceId}`,
        capabilities: {
          brokerUrl,
          discoveryPrefix,
          entities: [],
          status: [],
        },
        status: { online: true, state: 'unknown' },
        payload: {
          brokerUrl,
          discoveryPrefix,
          manufacturer: mqttDeviceField(parsed.config, 'manufacturer', 'mf') || null,
          model: mqttDeviceField(parsed.config, 'model', 'mdl') || null,
          discoveryTopics: [],
        },
        entities: [],
      } as ProviderDevice & { entities: ProviderEntity[] });

    const entity = mqttEntityFromConfig(parsed, existing.entities.length + 1);
    existing.entities.push(entity);
    existing.name = existing.name || deviceName;
    existing.deviceType = existing.deviceType === 'sensor' && entityType !== 'sensor' ? entityType : existing.deviceType;
    existing.capabilities.entities = existing.entities;
    existing.capabilities.status = mqttStatusEntries(existing.entities);
    existing.payload.entities = existing.entities;
    existing.payload.discoveryTopics = [...(existing.payload.discoveryTopics || []), message.topic];
    devices.set(deviceId, existing);
  }
  return [...devices.values()].map((device) => ({
    ...device,
    capabilities: {
      ...device.capabilities,
      primarySwitchCode: device.entities.some((entity) => ['switch', 'light', 'fan'].includes(entity.type) && entity.commandSchema?.commandTopic) ? 'switch_1' : null,
    },
  }));
}

function parseMqttDiscoveryMessage(message: MqttMessage, discoveryPrefix: string): { topic: string; component: string; objectId: string; config: JsonObject } | null {
  const parts = message.topic.split('/').filter(Boolean);
  if (parts[0] !== discoveryPrefix || parts.at(-1) !== 'config' || parts.length < 4) return null;
  if (!message.payload.trim()) return null;
  let config: JsonObject;
  try {
    config = JSON.parse(message.payload) as JsonObject;
  } catch {
    return null;
  }
  const component = parts[1] || 'sensor';
  const objectId = parts.length >= 5 ? parts.slice(3, -1).join('_') : parts[2];
  return { topic: message.topic, component, objectId, config };
}

function mqttEntityFromConfig(parsed: { topic: string; component: string; objectId: string; config: JsonObject }, index: number): ProviderEntity {
  const config = parsed.config;
  const commandTopic = mqttConfigString(config, 'command_topic', 'cmd_t');
  const stateTopic = mqttConfigString(config, 'state_topic', 'stat_t');
  const entityType = mqttDeviceType(parsed.component, config);
  const key = mqttConfigString(config, 'unique_id', 'uniq_id') || parsed.objectId || `entity_${index}`;
  const payloadOn = mqttConfigString(config, 'payload_on', 'pl_on') || 'ON';
  const payloadOff = mqttConfigString(config, 'payload_off', 'pl_off') || 'OFF';
  const commands = mqttCommandsForEntity(entityType, commandTopic);
  const commandSchema: JsonObject = {
    commands,
    switchCode: `switch_${index}`,
    component: parsed.component,
    commandTopic,
    jsonCommandTopic: mqttJsonCommandTopic(commandTopic),
    stateTopic,
    payloadOn,
    payloadOff,
    payloadOpen: mqttConfigString(config, 'payload_open', 'pl_open') || 'OPEN',
    payloadClose: mqttConfigString(config, 'payload_close', 'pl_close') || 'CLOSE',
    payloadStop: mqttConfigString(config, 'payload_stop', 'pl_stop') || 'STOP',
    positionTopic: mqttConfigString(config, 'position_topic', 'pos_t'),
    setPositionTopic: mqttConfigString(config, 'set_position_topic', 'set_pos_t'),
  };
  return {
    key,
    type: entityType,
    name: mqttConfigString(config, 'name', 'name') || parsed.objectId || key,
    commandSchema,
    state: { online: true, state: 'unknown', dps: { [String(index)]: false } },
    capabilities: { discoveryTopic: parsed.topic, config },
  };
}

function mqttStatusEntries(entities: ProviderEntity[]): JsonObject[] {
  return entities
    .filter((entity) => ['switch', 'light', 'fan'].includes(entity.type) && entity.commandSchema?.commandTopic)
    .map((entity, index) => ({ code: `switch_${index + 1}`, value: false, entityKey: entity.key }));
}

function mqttCommandsForEntity(entityType: string, commandTopic: string): string[] {
  if (!commandTopic) return ['query'];
  if (entityType === 'cover') return ['open', 'close', 'stop', 'set_position', 'jog_open', 'jog_close', 'jog_stop', 'calibrate_open', 'calibrate_closed', 'calibrate_zero', 'calibrate_max_steps', 'publish'];
  return ['turn_on', 'turn_off', 'toggle', 'set', 'publish'];
}

function mqttJsonCommandTopic(commandTopic: string): string {
  return commandTopic.replace(/\/cover\/set$/, '/command');
}

function mqttDeviceId(config: JsonObject, topic: string): string {
  const device = mqttDeviceObject(config);
  const identifiers = device.identifiers || device.ids;
  if (Array.isArray(identifiers) && identifiers.length) return String(identifiers[0]);
  if (typeof identifiers === 'string' && identifiers.trim()) return identifiers.trim();
  const connections = device.connections || device.cns;
  if (Array.isArray(connections) && Array.isArray(connections[0]) && connections[0][1]) return String(connections[0][1]);
  return mqttConfigString(config, 'unique_id', 'uniq_id') || topic.replace(/\/config$/, '').replaceAll('/', ':');
}

function mqttDeviceName(config: JsonObject, fallback: string): string {
  return mqttDeviceField(config, 'name', 'name') || mqttConfigString(config, 'name', 'name') || fallback || 'Dispositivo MQTT';
}

function mqttDeviceField(config: JsonObject, key: string, shortKey: string): string {
  const device = mqttDeviceObject(config);
  return mqttConfigString(device, key, shortKey);
}

function mqttDeviceObject(config: JsonObject): JsonObject {
  const device = config.device || config.dev;
  return device && typeof device === 'object' && !Array.isArray(device) ? device : {};
}

function mqttDeviceType(component: string, config: JsonObject): string {
  const override = mqttConfigString(config, 'mini_has_device_type', 'mini_has_device_type') || mqttConfigString(config, 'device_type', 'deviceType') || mqttConfigString(config, 'platform', 'platform');
  if (['switch', 'light', 'fan', 'cover', 'climate', 'lock', 'sensor', 'iot'].includes(override)) return override;
  const normalized = component.replace(/^binary_/, '');
  if (['switch', 'light', 'fan', 'cover', 'climate', 'lock'].includes(normalized)) return normalized;
  const deviceClass = mqttConfigString(config, 'device_class', 'dev_cla').toLowerCase();
  if (['outlet', 'switch', 'plug'].includes(deviceClass)) return 'switch';
  if (['temperature', 'humidity', 'power', 'energy', 'voltage', 'current', 'illuminance'].includes(deviceClass)) return 'sensor';
  return normalized === 'sensor' ? 'sensor' : 'iot';
}

function mqttConfigString(config: JsonObject, key: string, shortKey: string): string {
  const value = config[key] ?? config[shortKey];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTuyaDevice(device: JsonObject, region: (typeof TUYA_REGIONS)[number]): ProviderDevice {
  const status = Array.isArray(device.status) ? device.status : [];
  const detectedSwitchCode = primarySwitchCode(status);
  const kind = inferTuyaKind(device, detectedSwitchCode);
  const switchCode = kind === 'FEEDER' ? null : detectedSwitchCode;
  const switchCodes = kind === 'FEEDER' ? [] : switchCodesFrom(status);
  const localKey = String(device.local_key || '').trim() || null;
  const ip = String(device.last_ip || device.ip || '').trim() || null;
  const externalId = String(device.id || device.dev_id || '').trim();
  const name = String(device.name || device.product_name || 'Dispositivo Tuya').trim();
  const entityType = kind === 'light' ? 'light' : kind === 'switch' ? 'switch' : kind === 'sensor' ? 'sensor' : kind;
  const entities: ProviderEntity[] = switchCodes.map((code, index) => {
    const value = status.find((entry) => entry.code === code)?.value;
    return {
      key: code,
      type: entityType,
      name: switchCodes.length === 1 ? name : `${name} ${index + 1}`,
      commandSchema: { commands: ['turn_on', 'turn_off', 'toggle'], switchCode: code },
      state: { online: device.online, status, value, state: value === true ? 'on' : 'off' },
      capabilities: { status },
    };
  });

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
    capabilities: {
      category: device.category,
      primarySwitchCode: switchCode,
      status,
      ...(kind === 'FEEDER' ? {
        feeder: {
          maxPortions: 12,
          dps: { mealPlan: 1, manualFeed: 3, feedState: 4, factoryReset: 14, feedReport: 15 },
        },
      } : {}),
    },
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
  if (kind === 'FEEDER') {
    return String(status.find((item) => item.code === 'feed_state')?.value || (online === false ? 'offline' : 'standby'));
  }
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

async function readJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return { raw: text };
  }
}

function smartthingsExpiresAt(expiresIn: unknown): string | undefined {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function smartthingsErrorMessage(body: JsonObject, status: number, fallback = 'Falha na API SmartThings.'): string {
  const detail = body.message || body.error_description || body.error || body.detail || body.raw;
  if (typeof detail === 'string' && detail.trim()) return `SmartThings HTTP ${status}: ${detail}`;
  return `${fallback} HTTP ${status}.`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
