import { Injectable } from '@nestjs/common';
import { URL } from 'node:url';
import { DEFAULT_PORT, DEFAULT_TIMEOUT_MS, TuyaLanClient } from './tuya-lan';
import { CommandRequest, CommandResult, Device, JsonObject, StoredIntegration } from './types';
import { ProvidersService } from './providers';
import { HomeService, dpsIdFromCode } from './services';

@Injectable()
export class CommandsService {
  constructor(
    private readonly home: HomeService,
    private readonly providers: ProvidersService,
  ) {}

  async executeDeviceCommand(device: Device, secrets: JsonObject, request: CommandRequest): Promise<CommandResult> {
    try {
      if (['tuya_cloud', 'tuya_local', 'intelbras_izy_tuya'].includes(device.provider)) {
        return this.executeTuyaCommand(device, secrets, request);
      }
      if (device.provider === 'smartthings_cloud') return this.executeSmartthingsCommand(device, request);
      if (device.provider === 'mqtt') return this.executeMqttCommand(device, request);
      if (['generic_iot', 'persiana_custom'].includes(device.provider)) return this.executeHttpCommand(device, request);
      return { ok: false, status: 'unsupported', message: `Provider ${device.provider} ainda nao tem executor.`, result: {} };
    } catch (error) {
      return { ok: false, status: 'error', message: messageFrom(error), result: { deviceId: device.id, command: request.command } };
    }
  }

  private async executeTuyaCommand(device: Device, secrets: JsonObject, request: CommandRequest): Promise<CommandResult> {
    const transport = String((request.params || {}).transport || 'local').trim();
    if (transport === 'cloud') return this.executeTuyaCloudCommand(device, request);
    try {
      return await this.executeTuyaLocalCommand(device, secrets, request);
    } catch (localError) {
      if (!device.integrationId) throw localError;
      const cloudResult = await this.executeTuyaCloudCommand(device, request);
      return {
        ...cloudResult,
        message: 'Comando enviado pela Tuya Cloud apos falha na conexao local.',
        result: { ...cloudResult.result, fallbackFrom: 'local', localError: messageFrom(localError) },
      };
    }
  }

  private async executeSmartthingsCommand(device: Device, request: CommandRequest): Promise<CommandResult> {
    if (!device.integrationId) throw new Error('Device SmartThings sem integrationId.');
    let integration = this.home.getIntegration(device.integrationId);
    const latestIntegration = this.home.findLatestIntegrationByType('smartthings_cloud');
    if (latestIntegration && (!integration || (request.command !== 'query' && !smartthingsCanExecute(integration)))) {
      integration = latestIntegration;
    }
    if (!integration) throw new Error('Integracao SmartThings nao encontrada.');
    if (request.command === 'query') {
      const result = await this.providers.getSmartthingsDeviceStatus(integration, device.externalId);
      return {
        ok: true,
        status: 'ok',
        message: 'Status SmartThings consultado.',
        result: { deviceId: device.id, provider: device.provider, transport: 'cloud', action: 'query', ...result },
      };
    }
    if (!smartthingsCanExecute(integration)) {
      throw new Error('SmartThings conectado sem permissao de comando. Reconecte usando o OAuth com escopo x:devices:*.');
    }
    const commands = smartthingsCommandsFromRequest(device, request);
    const result = await this.providers.sendSmartthingsDeviceCommands(integration, device.externalId, commands);
    return {
      ok: true,
      status: 'sent',
      message: 'Comando enviado para SmartThings.',
      result: { deviceId: device.id, provider: device.provider, transport: 'cloud', commands, ...result },
    };
  }

  private async executeTuyaCloudCommand(device: Device, request: CommandRequest): Promise<CommandResult> {
    if (!device.integrationId) throw new Error('Device Tuya sem integrationId.');
    const integration = this.home.getIntegration(device.integrationId);
    if (!integration) throw new Error('Integracao Tuya nao encontrada.');
    const commands = tuyaCommandsFromRequest(device, request);
    const result = await this.providers.sendTuyaDeviceCommands(integration, device.externalId, commands);
    return {
      ok: true,
      status: 'sent',
      message: 'Comando enviado para Tuya.',
      result: { deviceId: device.id, provider: device.provider, commands, dps: dpsFromTuyaCommands(commands), ...result },
    };
  }

  private async executeTuyaLocalCommand(device: Device, secrets: JsonObject, request: CommandRequest): Promise<CommandResult> {
    const config = tuyaLocalConfig(device, secrets, request);
    const dpsId = tuyaLocalDpsId(device, request);
    const client = new TuyaLanClient(config.ip, config.deviceId, config.localKey, config.port, config.timeoutMs);
    try {
      await client.connect();
      if (request.command === 'query') {
        const payload = await client.queryStatus(config.cid);
        return tuyaLocalResult(device, config, 'query', dpsId, null, payload);
      }
      const value = await tuyaLocalValue(device, request, dpsId, client, config.cid);
      const payload = (request.params || {}).waitForStatus === false ? await client.setDpsValueNowait(dpsId, value, config.cid) : await client.setDpsValue(dpsId, value, config.cid);
      return tuyaLocalResult(device, config, 'command', dpsId, value, payload);
    } finally {
      client.close();
    }
  }

  private async executeHttpCommand(device: Device, request: CommandRequest): Promise<CommandResult> {
    const baseUrl = httpBaseUrl(device);
    if (!baseUrl) throw new Error('Device sem baseUrl para comando HTTP.');
    const params = request.params || {};
    const method = String(params.method || 'POST').toUpperCase();
    const path = String(params.path || `/${request.command}`);
    const body = params.body || { command: request.command, params };
    const url = new URL(path.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString();
    const response = await this.providers.httpJson(method, url, { 'Content-Type': 'application/json' }, JSON.stringify(body));
    return { ok: true, status: 'sent', message: 'Comando enviado por HTTP.', result: { deviceId: device.id, provider: device.provider, response } };
  }

  private async executeMqttCommand(device: Device, request: CommandRequest): Promise<CommandResult> {
    if (!device.integrationId) throw new Error('Device MQTT sem integrationId.');
    const integration = this.home.getIntegration(device.integrationId);
    if (!integration) throw new Error('Integracao MQTT nao encontrada.');
    if (request.command === 'query') {
      const snapshot = await this.mqttStatusSnapshot(integration, device);
      return {
        ok: true,
        status: 'ok',
        message: snapshot ? 'Status MQTT atualizado.' : 'Status MQTT mantido em cache local.',
        result: { deviceId: device.id, provider: device.provider, transport: 'mqtt', action: 'query', ...(snapshot || {}) },
      };
    }
    const command = mqttCommandFromRequest(device, request);
    const result = await this.providers.publishMqttCommand(integration, command.topic, command.payload, command.retain);
    const snapshot = await this.mqttStatusSnapshot(integration, device);
    return {
      ok: true,
      status: 'sent',
      message: 'Comando MQTT publicado.',
      result: {
        deviceId: device.id,
        provider: device.provider,
        transport: 'mqtt',
        action: request.command,
        dps: { ...command.dps, ...((snapshot?.dps || {}) as JsonObject) },
        ...(snapshot || {}),
        ...result,
      },
    };
  }

  private async mqttStatusSnapshot(integration: StoredIntegration, device: Device): Promise<JsonObject | null> {
    const topic = mqttStatusSubscriptionTopic(device);
    if (!topic) return null;
    const messages = await this.providers.collectMqttMessages(integration, topic, 800);
    return mqttSnapshotFromMessages(messages, device);
  }
}

function tuyaLocalResult(device: Device, config: JsonObject, action: string, dpsId: string, value: unknown, payload: JsonObject): CommandResult {
  return {
    ok: true,
    status: action === 'command' ? 'sent' : 'ok',
    message: action === 'command' ? 'Comando enviado pela rede local.' : 'Status local consultado.',
    result: {
      deviceId: device.id,
      provider: device.provider,
      transport: 'local',
      ip: config.ip,
      port: config.port,
      dpsId,
      value,
      dps: payload && typeof payload === 'object' ? payload.dps : null,
    },
  };
}

function tuyaLocalConfig(device: Device, secrets: JsonObject, request: CommandRequest): JsonObject {
  const params = request.params || {};
  const ip = firstNonEmpty(
    params.ip,
    nested(device.payload, 'local', 'ip'),
    device.payload.ip,
    nested(device.payload, 'payload', 'ip'),
    nested(device.payload, 'payload', 'raw', 'last_ip'),
    nested(device.payload, 'payload', 'raw', 'ip'),
    String(device.localDeviceKey || '').startsWith('ip:') ? String(device.localDeviceKey).replace(/^ip:/, '') : null,
  );
  const localKey = firstNonEmpty(params.localKey, secrets.localKey, nested(device.payload, 'local', 'localKey'));
  const deviceId = firstNonEmpty(params.deviceId, device.payload.externalId, nested(device.payload, 'local', 'deviceId'), device.externalId);
  if (!ip) throw new Error('Device sem IP local. Vincule com discovery ou informe params.ip.');
  if (!localKey) throw new Error('Device sem localKey. Sincronize pela Tuya Cloud ou cadastre a chave local.');
  return {
    ip,
    deviceId,
    localKey,
    cid: firstNonEmpty(params.cid, nested(device.payload, 'local', 'cid'), device.payload.cid),
    port: Number(params.port || nested(device.payload, 'local', 'port') || device.payload.port || DEFAULT_PORT),
    timeoutMs: Number(params.timeoutMs || DEFAULT_TIMEOUT_MS),
  };
}

function tuyaLocalDpsId(device: Device, request: CommandRequest): string {
  const params = request.params || {};
  const rawCommands = params.commands;
  const firstCommand = Array.isArray(rawCommands) && rawCommands[0] && typeof rawCommands[0] === 'object' ? rawCommands[0] : {};
  const rawCode = firstNonEmpty(
    params.dpsId,
    params.dpId,
    params.primaryDpsId,
    firstCommand.dpsId,
    firstCommand.dpId,
    firstCommand.code,
    nested(device.payload, 'local', 'primaryDpsId'),
    device.payload.primaryDpsId,
    device.capabilities.primaryDpsId,
    device.capabilities.primarySwitchCode,
  );
  if (!rawCode) return '1';
  const code = String(rawCode);
  return dpsIdFromCode(code);
}

async function tuyaLocalValue(device: Device, request: CommandRequest, dpsId: string, client: TuyaLanClient, cid?: string | null): Promise<unknown> {
  const params = request.params || {};
  const rawCommands = params.commands;
  if (Array.isArray(rawCommands) && rawCommands[0] && typeof rawCommands[0] === 'object' && 'value' in rawCommands[0]) return rawCommands[0].value;
  if (request.command === 'turn_on') return true;
  if (request.command === 'turn_off') return false;
  if (request.command === 'toggle') {
    const payload = await client.queryStatus(cid);
    const current = (payload.dps || {})[dpsId];
    if (typeof current !== 'boolean') throw new Error('Nao consegui inferir o estado atual para toggle local.');
    return !current;
  }
  if (request.command === 'set') {
    if (!('value' in params)) throw new Error('Parametro value obrigatorio para set.');
    return params.value;
  }
  if (['open', 'close', 'stop'].includes(request.command)) return request.command;
  if (request.command === 'set_position') {
    if (!('position' in params)) throw new Error('Parametro position obrigatorio para set_position.');
    return params.position;
  }
  if ('value' in params) return params.value;
  throw new Error('Comando local invalido. Envie turn_on/turn_off/toggle, set ou params.commands.');
}

function tuyaCommandsFromRequest(device: Device, request: CommandRequest): JsonObject[] {
  const params = request.params || {};
  if (Array.isArray(params.commands) && params.commands.length) return params.commands;
  let code = String(params.code || params.switchCode || '').trim();
  if (!code) {
    const dpsId = params.dpsId || params.dpId;
    if (dpsId !== undefined && dpsId !== null) {
      const dpsCode = String(dpsId).trim();
      code = /^\d+$/.test(dpsCode) ? `switch_${dpsCode}` : dpsCode;
    }
  }
  if (!code) code = String(device.capabilities.primarySwitchCode || '').trim();
  if (request.command === 'turn_on') return [{ code: requiredCode(code), value: true }];
  if (request.command === 'turn_off') return [{ code: requiredCode(code), value: false }];
  if (request.command === 'toggle') return [{ code: requiredCode(code), value: !currentBoolValue(device, code) }];
  if (request.command === 'set') return [{ code: requiredCode(code), value: params.value }];
  if (['open', 'close', 'stop'].includes(request.command)) return [{ code: params.code || 'control', value: request.command }];
  if (request.command === 'set_position') {
    if (!('position' in params)) throw new Error('Parametro position obrigatorio para set_position.');
    return [{ code: params.code || 'percent_control', value: params.position }];
  }
  if (code && 'value' in params) return [{ code, value: params.value }];
  throw new Error('Comando Tuya invalido. Envie turn_on/turn_off/toggle ou params.commands.');
}

function dpsFromTuyaCommands(commands: JsonObject[]): JsonObject {
  const dps: JsonObject = {};
  for (const command of commands) {
    const code = String(command.code || '');
    if (!code || !('value' in command)) continue;
    dps[dpsIdFromCode(code)] = command.value;
  }
  return dps;
}

function smartthingsCommandsFromRequest(device: Device, request: CommandRequest): JsonObject[] {
  const params = request.params || {};
  if (Array.isArray(params.commands) && params.commands.length) return params.commands;
  const component = String(params.component || params.componentId || 'main');
  const capability = String(params.capability || params.capabilityId || smartthingsPrimaryCapability(device));
  if (request.command === 'turn_on') return [smartthingsCommand(component, capability, 'on')];
  if (request.command === 'turn_off') return [smartthingsCommand(component, capability, 'off')];
  if (request.command === 'set') {
    const value = params.value;
    if (capability === 'switch' && typeof value === 'boolean') return [smartthingsCommand(component, capability, value ? 'on' : 'off')];
    if (typeof value === 'string') return [smartthingsCommand(component, capability, value)];
    throw new Error('Parametro value invalido para comando SmartThings.');
  }
  if (request.command === 'toggle') return [smartthingsCommand(component, capability, currentSmartthingsSwitchValue(device) ? 'off' : 'on')];
  if (request.command) return [smartthingsCommand(component, capability, request.command)];
  throw new Error('Comando SmartThings invalido.');
}

function smartthingsCommand(component: string, capability: string, command: string): JsonObject {
  return { component, capability, command };
}

function smartthingsCanExecute(integration: StoredIntegration): boolean {
  const scope = String(integration.secrets.scope || integration.config.scope || '');
  return scope.split(/\s+/).includes('x:devices:*');
}

function mqttCommandFromRequest(device: Device, request: CommandRequest): { topic: string; payload: unknown; retain: boolean; dps: JsonObject } {
  const params = request.params || {};
  const entity = mqttEntityForRequest(device, request);
  const schema = (entity?.commandSchema || {}) as JsonObject;
  const discoveryConfig = ((entity?.capabilities || {}) as JsonObject).config || {};
  const setPositionTopic = schema.setPositionTopic || schema.positionTopic || nested(discoveryConfig, 'set_position_topic') || nested(discoveryConfig, 'set_pos_t') || nested(discoveryConfig, 'position_topic') || nested(discoveryConfig, 'pos_t');
  const jsonCommandTopic = schema.jsonCommandTopic || mqttJsonCommandTopic(String(schema.commandTopic || ''));
  const topic = String(params.topic || mqttTopicForCommand(request.command, schema, setPositionTopic, jsonCommandTopic) || schema.commandTopic || '').trim();
  if (!topic) throw new Error('Device MQTT sem command_topic. Envie params.topic ou sincronize MQTT Discovery.');
  const dpsId = dpsIdFromCode(String(params.dpsId || params.dpId || schema.switchCode || '1'));
  const currentValue = device.status?.dps?.[dpsId];
  const payload = mqttPayloadFromRequest(request, schema, currentValue);
  return {
    topic,
    payload,
    retain: Boolean(params.retain),
    dps: { [dpsId]: mqttDpsValue(payload, schema) },
  };
}

function mqttEntityForRequest(device: Device, request: CommandRequest): JsonObject | null {
  const params = request.params || {};
  const entities = Array.isArray(device.payload.entities) ? device.payload.entities : [];
  if (!entities.length) return null;
  const requestedKey = String(params.entityKey || params.entity || params.key || '').trim();
  if (requestedKey) {
    const byKey = entities.find((entity) => entity && typeof entity === 'object' && String((entity as JsonObject).key || '') === requestedKey);
    if (byKey && typeof byKey === 'object') return byKey as JsonObject;
  }
  const dpsId = dpsIdFromCode(String(params.dpsId || params.dpId || '1'));
  const bySwitchCode = entities.find((entity) => {
    if (!entity || typeof entity !== 'object') return false;
    const schema = ((entity as JsonObject).commandSchema || {}) as JsonObject;
    return dpsIdFromCode(String(schema.switchCode || '')) === dpsId;
  });
  if (bySwitchCode && typeof bySwitchCode === 'object') return bySwitchCode as JsonObject;
  const withCommandTopic = entities.find((entity) => entity && typeof entity === 'object' && ((entity as JsonObject).commandSchema || {}).commandTopic);
  return withCommandTopic && typeof withCommandTopic === 'object' ? (withCommandTopic as JsonObject) : null;
}

function mqttPayloadFromRequest(request: CommandRequest, schema: JsonObject, currentValue: unknown): unknown {
  const params = request.params || {};
  if ('payload' in params) return params.payload;
  if (request.command === 'turn_on') return schema.payloadOn || 'ON';
  if (request.command === 'turn_off') return schema.payloadOff || 'OFF';
  if (request.command === 'toggle') return currentValue === true || String(currentValue).toUpperCase() === String(schema.payloadOn || 'ON').toUpperCase() ? schema.payloadOff || 'OFF' : schema.payloadOn || 'ON';
  if (request.command === 'open') return schema.payloadOpen || 'OPEN';
  if (request.command === 'close') return schema.payloadClose || 'CLOSE';
  if (request.command === 'stop') return schema.payloadStop || 'STOP';
  if (request.command === 'set_position') {
    const position = params.position ?? params.value;
    if (position === undefined || position === null) throw new Error('Parametro position obrigatorio para set_position.');
    return position;
  }
  if (request.command === 'jog_open') return { jog: 'open' };
  if (request.command === 'jog_close') return { jog: 'close' };
  if (request.command === 'jog_stop') return { jog: 'stop' };
  if (request.command === 'calibrate_open') return { calibration: { setOpenHere: true } };
  if (request.command === 'calibrate_closed') return { calibration: { setClosedHere: true } };
  if (request.command === 'calibrate_zero') return { calibration: { zeroHere: true } };
  if (request.command === 'calibrate_max_steps') {
    const maxSteps = params.maxSteps ?? params.value;
    if (maxSteps === undefined || maxSteps === null) throw new Error('Parametro maxSteps obrigatorio para calibrate_max_steps.');
    return { calibration: { maxSteps } };
  }
  if (request.command === 'set') {
    if (!('value' in params)) throw new Error('Parametro value ou payload obrigatorio para MQTT set.');
    if (typeof params.value === 'boolean') return params.value ? schema.payloadOn || 'ON' : schema.payloadOff || 'OFF';
    return params.value;
  }
  if (request.command === 'publish' || request.command === 'custom') {
    if ('value' in params) return params.value;
    throw new Error('Parametro payload ou value obrigatorio para MQTT publish.');
  }
  return request.command;
}

function mqttTopicForCommand(command: string, schema: JsonObject, setPositionTopic: unknown, jsonCommandTopic: unknown): string {
  if (command === 'set_position') return String(setPositionTopic || '');
  if (['jog_open', 'jog_close', 'jog_stop', 'calibrate_open', 'calibrate_closed', 'calibrate_zero', 'calibrate_max_steps'].includes(command)) {
    return String(jsonCommandTopic || '');
  }
  return String(schema.commandTopic || '');
}

function mqttJsonCommandTopic(commandTopic: string): string {
  return commandTopic.replace(/\/cover\/set$/, '/command');
}

function mqttDpsValue(payload: unknown, schema: JsonObject): unknown {
  const payloadOn = String(schema.payloadOn || 'ON').toUpperCase();
  const payloadOff = String(schema.payloadOff || 'OFF').toUpperCase();
  const normalized = String(payload).toUpperCase();
  if (normalized === payloadOn) return true;
  if (normalized === payloadOff) return false;
  if (normalized === String(schema.payloadOpen || 'OPEN').toUpperCase()) return 0;
  if (normalized === String(schema.payloadClose || 'CLOSE').toUpperCase()) return 100;
  if (normalized === String(schema.payloadStop || 'STOP').toUpperCase()) return 'stopped';
  return payload;
}

function mqttStatusSubscriptionTopic(device: Device): string {
  const schema = mqttPrimaryCommandSchema(device);
  const commandTopic = String(schema.commandTopic || '').trim();
  const stateTopic = String(schema.stateTopic || '').trim();
  const positionTopic = String(schema.positionTopic || '').trim();
  const topic = commandTopic || stateTopic || positionTopic;
  const base = topic
    .replace(/\/cover\/set$/, '')
    .replace(/\/cover\/state$/, '')
    .replace(/\/cover\/position$/, '')
    .replace(/\/state$/, '');
  return base && base !== topic ? `${base}/#` : '';
}

function mqttPrimaryCommandSchema(device: Device): JsonObject {
  const entities = Array.isArray(device.payload.entities) ? device.payload.entities : [];
  const entity = entities.find((item) => item && typeof item === 'object' && ((item as JsonObject).commandSchema || {}).commandTopic);
  return ((entity as JsonObject | undefined)?.commandSchema || {}) as JsonObject;
}

function mqttSnapshotFromMessages(messages: { topic: string; payload: string }[], device: Device): JsonObject | null {
  if (!messages.length) return null;
  const schema = mqttPrimaryCommandSchema(device);
  const commandTopic = String(schema.commandTopic || '').trim();
  const base = commandTopic.replace(/\/cover\/set$/, '');
  const jsonStateTopic = base ? `${base}/state` : '';
  const coverStateTopic = String(schema.stateTopic || (base ? `${base}/cover/state` : '')).trim();
  const positionTopic = String(schema.positionTopic || (base ? `${base}/cover/position` : '')).trim();
  const availabilityTopic = base ? `${base}/availability` : '';
  let rawStatus: JsonObject = {};
  let coverState = '';
  let position: number | null = null;
  let online: boolean | null = null;

  for (const message of messages) {
    if (message.topic === jsonStateTopic) {
      const parsed = parseJsonObject(message.payload);
      if (parsed) rawStatus = parsed;
      continue;
    }
    if (message.topic === coverStateTopic) {
      coverState = message.payload.trim().toLowerCase();
      continue;
    }
    if (message.topic === positionTopic) {
      const parsedPosition = Number(message.payload);
      if (Number.isFinite(parsedPosition)) position = Math.max(0, Math.min(100, Math.round(parsedPosition)));
      continue;
    }
    if (message.topic === availabilityTopic) {
      online = message.payload.trim().toLowerCase() === 'online';
    }
  }

  const state = coverState || stateFromCoverPosition(position);
  const statusSummary: JsonObject = {
    online: online ?? true,
    raw: rawStatus,
  };
  if (state) statusSummary.state = state;
  if (position !== null) statusSummary.position = position;

  const dps: JsonObject = {};
  if (position !== null) dps['1'] = position;
  return { rawStatus, statusSummary, dps };
}

function parseJsonObject(value: string): JsonObject | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stateFromCoverPosition(position: number | null): string {
  if (position === null) return '';
  if (position <= 2) return 'open';
  if (position >= 98) return 'closed';
  return 'stopped';
}

function smartthingsPrimaryCapability(device: Device): string {
  const capabilities = device.capabilities.capabilities;
  if (Array.isArray(capabilities) && capabilities.includes('switch')) return 'switch';
  if (Array.isArray(capabilities) && capabilities.length) return String(capabilities[0]);
  return 'switch';
}

function currentSmartthingsSwitchValue(device: Device): boolean {
  const state = String(device.status.state || '').toLowerCase();
  if (state === 'on') return true;
  if (state === 'off') return false;
  throw new Error('Nao consegui inferir o estado atual para toggle SmartThings.');
}

function requiredCode(code: string): string {
  if (!code) throw new Error('Codigo DP Tuya nao encontrado para este device.');
  return code;
}

function currentBoolValue(device: Device, code: string): boolean {
  for (const entry of device.capabilities.status || []) {
    if (entry.code === code && typeof entry.value === 'boolean') return entry.value;
  }
  throw new Error('Nao consegui inferir o estado atual para toggle.');
}

function httpBaseUrl(device: Device): string {
  const baseUrl = String(device.payload.baseUrl || device.capabilities.baseUrl || '').trim();
  if (baseUrl) return baseUrl;
  const localKey = device.localDeviceKey || '';
  return localKey.startsWith('http:') ? localKey.replace(/^http:/, '') : '';
}

function nested(value: JsonObject, ...keys: string[]): any {
  let current: any = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function firstNonEmpty(...values: any[]): any {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
