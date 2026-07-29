export class MiniHasClient {
  constructor({
    baseUrl = 'http://127.0.0.1:8000',
    inventoryTimeoutMs = 3000,
    commandTimeoutMs = 12000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch API indisponível.');
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.inventoryTimeoutMs = clampInteger(inventoryTimeoutMs, 500, 30000);
    this.commandTimeoutMs = clampInteger(commandTimeoutMs, 1000, 30000);
    this.fetchImpl = fetchImpl;
    this.controllers = new Set();
    this.closed = false;
  }

  async inventory() {
    const [devices, entities] = await Promise.all([
      this.request('/devices', {}, this.inventoryTimeoutMs),
      this.request('/entities', {}, this.inventoryTimeoutMs),
    ]);
    if (!Array.isArray(devices) || !Array.isArray(entities)) {
      throw new Error('Inventário inválido retornado pelo Mini-HAS.');
    }
    return { devices, entities };
  }

  async setPower(descriptor, enabled) {
    return this.commandDevice(descriptor.deviceId, enabled ? 'turn_on' : 'turn_off', {
      code: descriptor.switchCode,
    });
  }

  async openCover(descriptor) {
    return this.commandDevice(descriptor.deviceId, 'open');
  }

  async closeCover(descriptor) {
    return this.commandDevice(descriptor.deviceId, 'close');
  }

  async stopCover(descriptor) {
    return this.commandDevice(descriptor.deviceId, 'stop');
  }

  async setCoverPosition(descriptor, position) {
    return this.commandDevice(descriptor.deviceId, 'set_position', {
      position: clampNumber(position, 0, 100),
    });
  }

  async setClimatePower(descriptor, enabled) {
    return this.commandDevice(descriptor.deviceId, enabled ? 'turn_on' : 'turn_off');
  }

  async setClimateTarget(descriptor, targetCelsius) {
    const target = Math.round(clampNumber(targetCelsius, 16, 30) * 2) / 2;
    return this.commandDevice(descriptor.deviceId, 'set', {
      commands: [{
        component: 'main',
        capability: 'thermostatCoolingSetpoint',
        command: 'setCoolingSetpoint',
        arguments: [target],
      }],
    });
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  async commandDevice(deviceId, command, params = {}) {
    const result = await this.request(
      `/devices/${encodeURIComponent(String(deviceId))}/command`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, params }),
      },
      this.commandTimeoutMs,
    );
    if (result && typeof result === 'object' && result.ok === false) {
      throw new Error(String(result.message || `Comando ${command} recusado pelo Mini-HAS.`));
    }
    return result;
  }

  async request(path, options, timeoutMs) {
    if (this.closed) throw new Error('Cliente Mini-HAS encerrado.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    this.controllers.add(controller);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(`Resposta inválida do Mini-HAS em ${path}.`);
        }
      }
      if (!response.ok) {
        const message = payload && typeof payload === 'object' ? payload.message : '';
        throw new Error(String(message || `Mini-HAS respondeu HTTP ${response.status} em ${path}.`));
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted && !this.closed) {
        throw new Error(`Timeout ao acessar o Mini-HAS em ${path}.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
}

export function buildExposedDevices(inventory, config = {}) {
  const devices = Array.isArray(inventory?.devices) ? inventory.devices : [];
  const entities = Array.isArray(inventory?.entities) ? inventory.entities : [];
  const devicesById = new Map(devices.map((device) => [Number(device.id), device]));
  const lightEntityIds = new Set(toIntegerArray(config.lightEntityIds));
  const excludedDeviceIds = new Set(toIntegerArray(config.excludedDeviceIds));
  const excludedEntityIds = new Set(toIntegerArray(config.excludedEntityIds));
  const descriptors = [];
  const devicesWithEntities = new Set();

  for (const entity of entities) {
    const entityId = Number(entity?.id);
    const deviceId = Number(entity?.deviceId);
    const type = String(entity?.type || '').toLowerCase();
    const device = devicesById.get(deviceId);
    if (!Number.isInteger(entityId) || !Number.isInteger(deviceId) || !device) continue;
    devicesWithEntities.add(deviceId);
    if (excludedEntityIds.has(entityId) || excludedDeviceIds.has(deviceId)) continue;

    const commands = Array.isArray(entity?.commandSchema?.commands)
      ? entity.commandSchema.commands.map((command) => String(command))
      : [];
    const name = String(entity?.name || device?.name || `Mini-HAS ${entityId}`).trim();
    const stableId = `mini-has-entity-${entityId}`;
    const common = {
      stableId,
      serial: stableId,
      entityId,
      deviceId,
      name,
      roomName: String(device?.roomName || '').trim(),
      online: device?.status?.online !== false && entity?.state?.online !== false,
      device,
      entity,
    };

    if (type === 'binary_sensor' && String(entity?.capabilities?.deviceClass || '') === 'opening') {
      descriptors.push({
        ...common,
        kind: 'contact',
        contact: contactState(entity),
      });
      continue;
    }

    if (type === 'climate') {
      descriptors.push({
        ...common,
        kind: 'climate',
        ...climateSnapshot(device),
      });
      continue;
    }

    if (type === 'cover' && commands.includes('open') && commands.includes('close')) {
      descriptors.push({
        ...common,
        kind: 'cover',
        ...coverSnapshot(device, entity),
      });
      continue;
    }

    if (
      ['light', 'outlet', 'plug', 'socket', 'switch'].includes(type)
      && commands.includes('turn_on')
      && commands.includes('turn_off')
    ) {
      const switchCode = String(entity?.commandSchema?.switchCode || 'switch').trim();
      descriptors.push({
        ...common,
        kind: type === 'light' || lightEntityIds.has(entityId) || lightLikeName(name) ? 'light' : 'outlet',
        switchCode,
        on: powerState(device, entity, switchCode),
      });
      continue;
    }

    descriptors.push({
      ...common,
      name: `${name} Status`,
      kind: 'status',
      contact: statusFacadeContact(device, entity),
    });
  }

  for (const device of devices) {
    const deviceId = Number(device?.id);
    if (!Number.isInteger(deviceId) || devicesWithEntities.has(deviceId) || excludedDeviceIds.has(deviceId)) continue;
    const baseName = String(device?.name || `Mini-HAS ${deviceId}`).trim();
    const stableId = `mini-has-device-${deviceId}-status`;
    descriptors.push({
      stableId,
      serial: stableId,
      entityId: Number.MAX_SAFE_INTEGER - 100000 + deviceId,
      deviceId,
      name: `${baseName} ${deviceId} Status`,
      roomName: String(device?.roomName || '').trim(),
      online: device?.status?.online !== false,
      device,
      entity: null,
      kind: 'status',
      contact: statusFacadeContact(device, null),
    });
  }

  return descriptors.sort((left, right) => left.entityId - right.entityId);
}

export function powerState(device, entity, switchCode) {
  const dpsId = dpsIdFromCode(switchCode);
  const candidates = [
    device?.status?.dps?.[dpsId],
    entity?.state?.dps?.[dpsId],
    statusEntryValue(entity?.state?.status, switchCode),
    entity?.state?.value,
    entity?.state?.state,
    device?.status?.state,
  ];
  for (const candidate of candidates) {
    const parsed = booleanState(candidate);
    if (parsed !== null) return parsed;
  }
  return false;
}

export function coverSnapshot(device, entity) {
  const rawState = objectValue(device?.status?.raw?.state);
  const position = firstPosition([
    device?.status?.position,
    rawState.position,
    device?.status?.dps?.['1'],
    entity?.state?.value,
    entity?.state?.dps?.['1'],
  ]);
  const targetPosition = firstPosition([rawState.targetPosition, position]);
  const state = String(device?.status?.state || entity?.state?.state || '').toLowerCase();
  const moving = rawState.moving === true || state === 'opening' || state === 'closing';
  let movement = 'stopped';
  if (moving && (state === 'opening' || targetPosition < position)) movement = 'opening';
  if (moving && (state === 'closing' || targetPosition > position)) movement = 'closing';
  return { position, targetPosition, movement };
}

export function contactState(entity) {
  if (typeof entity?.state?.open === 'boolean') return !entity.state.open;
  return !['open', 'opened', 'on', 'active', 'violated'].includes(
    String(entity?.state?.state || '').toLowerCase(),
  );
}

export function climateSnapshot(device) {
  const power = booleanState(firstDefined([
    device?.status?.on,
    nestedValue(device?.status, 'raw', 'components', 'main', 'switch', 'switch', 'value'),
    device?.status?.state,
  ])) ?? false;
  const currentTemperature = finiteNumber(
    nestedValue(device?.status, 'raw', 'components', 'main', 'temperatureMeasurement', 'temperature', 'value'),
    24,
  );
  const targetTemperature = finiteNumber(
    nestedValue(device?.status, 'raw', 'components', 'main', 'thermostatCoolingSetpoint', 'coolingSetpoint', 'value'),
    24,
  );
  const rawMode = String(
    nestedValue(device?.status, 'raw', 'components', 'main', 'airConditionerMode', 'airConditionerMode', 'value') || 'cool',
  ).toLowerCase();
  return {
    on: power,
    currentTemperature: clampNumber(currentTemperature, -50, 100),
    targetTemperature: clampNumber(targetTemperature, 16, 30),
    mode: power ? (rawMode === 'auto' ? 'auto' : 'cool') : 'off',
  };
}

export function statusFacadeContact(device, entity) {
  if (device?.status?.online === false || entity?.state?.online === false) return false;
  if (entity?.state?.active === true || entity?.state?.siren === true || entity?.state?.zonesFiring === true) return false;
  const states = [entity?.state?.state, device?.status?.state]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean);
  return !states.some((state) => ['alarm', 'error', 'offline', 'triggered', 'unavailable'].includes(state));
}

export function dpsIdFromCode(code) {
  const normalized = String(code || '').trim();
  if (/^switch_\d+$/.test(normalized)) return normalized.slice('switch_'.length);
  if (normalized === 'switch_led') return '20';
  if (normalized === 'switch') return '1';
  return normalized || '1';
}

export function miniHasPositionToMatter(position) {
  return Math.round(clampNumber(position, 0, 100) * 100);
}

export function matterPositionToMiniHas(positionPercent100ths) {
  return Math.round(clampNumber(positionPercent100ths, 0, 10000) / 100);
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || 'http://127.0.0.1:8000'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL da API Mini-HAS inválida.');
  return url.toString().replace(/\/$/, '');
}

function toIntegerArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isInteger);
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clampNumber(value, minimum, maximum));
}

function clampNumber(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function firstPosition(values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(clampNumber(parsed, 0, 100));
  }
  return 0;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nestedValue(value, ...keys) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusEntryValue(entries, code) {
  if (!Array.isArray(entries)) return undefined;
  return entries.find((entry) => String(entry?.code || '') === code)?.value;
}

function booleanState(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'on', 'true', 'ligado'].includes(normalized)) return true;
  if (['0', 'off', 'false', 'desligado'].includes(normalized)) return false;
  return null;
}

function lightLikeName(name) {
  return /\b(luz|lâmpada|lampada|ilumina[cç][aã]o)\b/i.test(name);
}
