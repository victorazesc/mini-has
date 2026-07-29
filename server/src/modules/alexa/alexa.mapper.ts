import { Device, JsonObject, Scene } from '../../types';
import { deviceEndpointId, sceneEndpointId } from './alexa.schemas';

export const ALEXA_COVER_INSTANCE = 'Blind.Lift';

const POWER_DEVICE_TYPES = new Set(['climate', 'fan', 'light', 'switch']);
const SUPPORTED_DEVICE_TYPES = new Set([...POWER_DEVICE_TYPES, 'cover']);
const BLOCKED_DEVICE_TYPES = new Set([
    'alarm',
    'camera',
    'cam',
    'feeder',
    'printer',
]);
const BLOCKED_SCENE_COMMANDS = new Set([
    'arm',
    'arm_partition',
    'cancel',
    'disarm',
    'disarm_partition',
    'feed',
    'lock',
    'pause',
    'print',
    'resume',
    'start_print',
    'unlock',
]);
const RISK_TERM = /(^|\s)(alarm(e)?|alimentador|aquecedor|boiler|camera|churrasqueir\w*|cooktop|fechadura|feeder|fogao|forno|garage(m)?|gate|grill|heater|impressora|lock|oven|portao|printer|siren(e)?|trava)(\s|$)/;

export function isAlexaControllableDevice(
    device: Device,
    allowedDeviceIds = alexaAllowedDeviceIds(),
): boolean {
    if (device.capabilities.readOnly === true) return false;
    if (!SUPPORTED_DEVICE_TYPES.has(normalizedType(device))) return false;
    return !isAlexaRiskDevice(device) || allowedDeviceIds.has(device.id);
}

export function isAlexaRiskDevice(device: Device): boolean {
    if (BLOCKED_DEVICE_TYPES.has(normalizedType(device))) return true;
    return hasRiskTerm([
        device.name,
        device.deviceType,
        device.capabilities.category,
        device.capabilities.deviceClass,
        device.payload.category,
        device.payload.deviceClass,
    ]);
}

export function alexaAllowedDeviceIds(
    value = process.env.ALEXA_ALLOWED_DEVICE_IDS,
): ReadonlySet<number> {
    const ids = String(value || '')
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter((item) => /^[1-9]\d*$/.test(item))
        .map(Number)
        .filter(Number.isSafeInteger);
    return new Set(ids);
}

export function isAlexaSafeScene(
    scene: Scene,
    resolveDevice: (deviceId: number) => Device | null | undefined,
): boolean {
    if (!scene.actions.length) return false;
    return scene.actions.every((action) => {
        if (BLOCKED_SCENE_COMMANDS.has(String(action.command || '').toLowerCase())) {
            return false;
        }
        if (hasRiskTerm([action.deviceName, action.deviceType])) return false;

        const device = resolveDevice(action.deviceId);
        return Boolean(
            device
            && device.capabilities.readOnly !== true
            && !isAlexaRiskDevice(device),
        );
    });
}

export function isAlexaPowerDevice(device: Device): boolean {
    return POWER_DEVICE_TYPES.has(normalizedType(device));
}

export function isAlexaCoverDevice(device: Device): boolean {
    return normalizedType(device) === 'cover';
}

export function isAlexaClimateDevice(device: Device): boolean {
    return normalizedType(device) === 'climate';
}

export function deviceToAlexaEndpoint(device: Device): JsonObject {
    const capabilities: JsonObject[] = [];
    if (isAlexaPowerDevice(device)) capabilities.push(powerCapability());
    if (brightnessDescriptor(device)) capabilities.push(brightnessCapability());
    if (isAlexaCoverDevice(device)) capabilities.push(coverRangeCapability());
    if (isAlexaClimateDevice(device)) {
        capabilities.push(thermostatCapability(), temperatureSensorCapability());
    }
    capabilities.push(endpointHealthCapability(), alexaCapability());

    return {
        endpointId: deviceEndpointId(device.id),
        manufacturerName: 'Mini HAS',
        description: `${displayType(device)} conectado pelo Mini HAS`,
        friendlyName: friendlyName(device.name, `Dispositivo ${device.id}`),
        displayCategories: [displayCategory(device)],
        cookie: {
            miniHasKind: 'device',
            miniHasId: String(device.id),
        },
        capabilities,
    };
}

export function sceneToAlexaEndpoint(scene: Scene): JsonObject {
    return {
        endpointId: sceneEndpointId(scene.id),
        manufacturerName: 'Mini HAS',
        description: 'Cena conectada pelo Mini HAS',
        friendlyName: sceneFriendlyName(scene.name, `Cena ${scene.id}`),
        displayCategories: ['SCENE_TRIGGER'],
        cookie: {
            miniHasKind: 'scene',
            miniHasId: String(scene.id),
        },
        capabilities: [
            {
                type: 'AlexaInterface',
                interface: 'Alexa.SceneController',
                version: '3',
                supportsDeactivation: false,
                proactivelyReported: false,
            },
            alexaCapability(),
        ],
    };
}

export function deviceStateProperties(device: Device): JsonObject[] {
    const properties: JsonObject[] = [];
    if (isAlexaPowerDevice(device)) {
        const powerState = alexaPowerState(device);
        if (powerState) properties.push(powerStateProperty(device, powerState));
    }
    if (isAlexaCoverDevice(device)) {
        const miniHasPosition = miniHasCoverPosition(device);
        if (miniHasPosition !== null) {
            properties.push(rangeValueProperty(device, miniHasToAlexaOpening(miniHasPosition)));
        }
    }
    const brightness = alexaBrightness(device);
    if (brightness !== null) properties.push(brightnessProperty(device, brightness));
    if (isAlexaClimateDevice(device)) {
        const target = climateTargetCelsius(device);
        const current = climateCurrentCelsius(device);
        const mode = climateMode(device);
        if (target !== null) properties.push(thermostatTargetProperty(device, target));
        if (mode) properties.push(thermostatModeProperty(device, mode));
        if (current !== null) properties.push(temperatureProperty(device, current));
    }
    return properties;
}

export function powerStateProperty(
    device: Device,
    state: 'ON' | 'OFF',
): JsonObject {
    return property(device, 'Alexa.PowerController', 'powerState', state);
}

export function rangeValueProperty(
    device: Device,
    alexaOpening: number,
): JsonObject {
    return {
        ...property(
            device,
            'Alexa.RangeController',
            'rangeValue',
            clampPercent(alexaOpening),
        ),
        instance: ALEXA_COVER_INSTANCE,
    };
}

export function percentageProperty(
    device: Device,
    alexaOpening: number,
): JsonObject {
    return property(
        device,
        'Alexa.PercentageController',
        'percentage',
        clampPercent(alexaOpening),
    );
}

export function brightnessProperty(device: Device, brightness: number): JsonObject {
    return property(
        device,
        'Alexa.BrightnessController',
        'brightness',
        clampPercent(brightness),
    );
}

export function thermostatTargetProperty(device: Device, celsius: number): JsonObject {
    return property(device, 'Alexa.ThermostatController', 'targetSetpoint', {
        value: roundTemperature(celsius),
        scale: 'CELSIUS',
    });
}

export function thermostatModeProperty(
    device: Device,
    mode: 'AUTO' | 'COOL' | 'OFF',
): JsonObject {
    return property(device, 'Alexa.ThermostatController', 'thermostatMode', mode);
}

export function temperatureProperty(device: Device, celsius: number): JsonObject {
    return property(device, 'Alexa.TemperatureSensor', 'temperature', {
        value: roundTemperature(celsius),
        scale: 'CELSIUS',
    });
}

export function endpointHealthProperty(device: Device): JsonObject {
    return property(device, 'Alexa.EndpointHealth', 'connectivity', {
        value: deviceIsOnline(device) ? 'OK' : 'UNREACHABLE',
    });
}

export function miniHasCoverPosition(device: Device): number | null {
    const candidates = [
        device.status.position,
        nested(device.status, 'raw', 'state', 'position'),
        nested(device.status, 'dps', '1'),
    ];

    const statusEntries = Array.isArray(device.capabilities.status)
        ? device.capabilities.status
        : [];
    for (const entry of statusEntries) {
        if (!entry || typeof entry !== 'object') continue;
        const code = String(entry.code || '').toLowerCase();
        if (['position', 'percent_control', 'switch_1'].includes(code)) {
            candidates.push(entry.value);
        }
    }

    for (const value of candidates) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return clampPercent(numeric);
    }

    const state = String(device.status.state || '').toLowerCase();
    if (['open', 'opened'].includes(state)) return 0;
    if (['closed', 'close'].includes(state)) return 100;
    return null;
}

export function miniHasToAlexaOpening(miniHasPosition: number): number {
    return clampPercent(100 - miniHasPosition);
}

export function alexaOpeningToMiniHas(alexaOpening: number): number {
    return clampPercent(100 - alexaOpening);
}

export function alexaBrightness(device: Device): number | null {
    const descriptor = brightnessDescriptor(device);
    if (!descriptor) return null;
    const raw = device.status.dps?.[descriptor.code]
        ?? device.status.dps?.[descriptor.dpsId]
        ?? descriptor.value;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return clampPercent((value / descriptor.maximum) * 100);
}

export function brightnessCommand(
    device: Device,
    brightness: number,
): { code: string; value: number } | null {
    const descriptor = brightnessDescriptor(device);
    if (!descriptor) return null;
    const percent = clampPercent(brightness);
    return {
        code: descriptor.code,
        value: Math.max(
            descriptor.minimum,
            Math.min(
                descriptor.maximum,
                Math.round((percent / 100) * descriptor.maximum),
            ),
        ),
    };
}

export function climateTargetCelsius(device: Device): number | null {
    return finiteOrNull(
        nested(
            device.status,
            'raw',
            'components',
            'main',
            'thermostatCoolingSetpoint',
            'coolingSetpoint',
            'value',
        ),
    );
}

export function climateCurrentCelsius(device: Device): number | null {
    return finiteOrNull(
        nested(
            device.status,
            'raw',
            'components',
            'main',
            'temperatureMeasurement',
            'temperature',
            'value',
        ),
    );
}

export function climateMode(device: Device): 'AUTO' | 'COOL' | 'OFF' | null {
    const power = alexaPowerState(device);
    if (power === 'OFF') return 'OFF';
    const raw = String(
        nested(
            device.status,
            'raw',
            'components',
            'main',
            'airConditionerMode',
            'airConditionerMode',
            'value',
        ) || '',
    ).toLowerCase();
    if (raw === 'auto') return 'AUTO';
    if (raw === 'cool') return 'COOL';
    return null;
}

export function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function deviceIsOnline(device: Device): boolean {
    if (device.status.online === false) return false;
    return !['error', 'offline', 'unavailable'].includes(
        String(device.status.state || '').toLowerCase(),
    );
}

function alexaPowerState(device: Device): 'ON' | 'OFF' | null {
    const state = String(device.status.state || '').toLowerCase();
    if (['on', 'opening', 'closing', 'moving'].includes(state)) return 'ON';
    if (['off', 'idle', 'stopped'].includes(state)) return 'OFF';

    for (const value of [
        device.status.on,
        device.status.power,
        primaryDpsValue(device),
        primaryCapabilityValue(device),
    ]) {
        if (value === true || String(value).toLowerCase() === 'on') return 'ON';
        if (value === false || String(value).toLowerCase() === 'off') return 'OFF';
    }
    return null;
}

function primaryDpsValue(device: Device): unknown {
    const code = String(device.capabilities.primarySwitchCode || '');
    const dpsId = code.match(/(\d+)$/)?.[1];
    if (!dpsId || !isRecord(device.status.dps)) return undefined;
    return device.status.dps[dpsId];
}

function primaryCapabilityValue(device: Device): unknown {
    if (!Array.isArray(device.capabilities.status)) return undefined;
    const primaryCode = String(device.capabilities.primarySwitchCode || '');
    const entry = device.capabilities.status.find(
        (candidate: unknown) => isRecord(candidate)
            && String(candidate.code || '') === primaryCode,
    );
    return isRecord(entry) ? entry.value : undefined;
}

function property(
    device: Device,
    namespace: string,
    name: string,
    value: unknown,
): JsonObject {
    return {
        namespace,
        name,
        value,
        timeOfSample: timeOfSample(device),
        uncertaintyInMilliseconds: 500,
    };
}

function timeOfSample(device: Device): string {
    const raw = device.status.lastSeenAt || device.updatedAt;
    const parsed = new Date(String(raw || ''));
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function powerCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.PowerController',
        version: '3',
        properties: {
            supported: [{ name: 'powerState' }],
            proactivelyReported: false,
            retrievable: true,
        },
    };
}

function brightnessCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.BrightnessController',
        version: '3',
        properties: {
            supported: [{ name: 'brightness' }],
            proactivelyReported: false,
            retrievable: true,
        },
    };
}

function thermostatCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.ThermostatController',
        version: '3.2',
        properties: {
            supported: [
                { name: 'targetSetpoint' },
                { name: 'thermostatMode' },
            ],
            proactivelyReported: false,
            retrievable: true,
        },
        configuration: {
            supportedModes: ['OFF', 'COOL', 'AUTO'],
            supportsScheduling: false,
        },
    };
}

function temperatureSensorCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.TemperatureSensor',
        version: '3',
        properties: {
            supported: [{ name: 'temperature' }],
            proactivelyReported: false,
            retrievable: true,
        },
    };
}

function coverRangeCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.RangeController',
        instance: ALEXA_COVER_INSTANCE,
        version: '3',
        properties: {
            supported: [{ name: 'rangeValue' }],
            proactivelyReported: false,
            retrievable: true,
            nonControllable: false,
        },
        capabilityResources: {
            friendlyNames: [{
                '@type': 'asset',
                value: { assetId: 'Alexa.Setting.Opening' },
            }],
        },
        configuration: {
            supportedRange: {
                minimumValue: 0,
                maximumValue: 100,
                precision: 1,
            },
            unitOfMeasure: 'Alexa.Unit.Percent',
        },
        semantics: {
            actionMappings: [
                actionMapping('Alexa.Actions.Close', 'SetRangeValue', { rangeValue: 0 }),
                actionMapping('Alexa.Actions.Open', 'SetRangeValue', { rangeValue: 100 }),
                actionMapping('Alexa.Actions.Lower', 'AdjustRangeValue', {
                    rangeValueDelta: -10,
                    rangeValueDeltaDefault: false,
                }),
                actionMapping('Alexa.Actions.Raise', 'AdjustRangeValue', {
                    rangeValueDelta: 10,
                    rangeValueDeltaDefault: false,
                }),
            ],
            stateMappings: [
                {
                    '@type': 'StatesToValue',
                    states: ['Alexa.States.Closed'],
                    value: 0,
                },
                {
                    '@type': 'StatesToRange',
                    states: ['Alexa.States.Open'],
                    range: { minimumValue: 1, maximumValue: 100 },
                },
            ],
        },
    };
}

function actionMapping(action: string, name: string, payload: JsonObject): JsonObject {
    return {
        '@type': 'ActionsToDirective',
        actions: [action],
        directive: { name, payload },
    };
}

function endpointHealthCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa.EndpointHealth',
        version: '3',
        properties: {
            supported: [{ name: 'connectivity' }],
            proactivelyReported: false,
            retrievable: true,
        },
    };
}

function alexaCapability(): JsonObject {
    return {
        type: 'AlexaInterface',
        interface: 'Alexa',
        version: '3',
    };
}

function displayCategory(device: Device): string {
    const type = normalizedType(device);
    if (type === 'climate') return 'AIR_CONDITIONER';
    if (type === 'cover') return 'INTERIOR_BLIND';
    if (type === 'light') return 'LIGHT';
    if (type === 'fan') return 'FAN';
    return 'SWITCH';
}

function displayType(device: Device): string {
    const type = normalizedType(device);
    if (type === 'climate') return 'Ar-condicionado';
    if (type === 'cover') return 'Persiana';
    if (type === 'light') return 'Luz';
    if (type === 'fan') return 'Ventilador';
    return 'Interruptor';
}

function normalizedType(device: Device): string {
    return String(device.deviceType || '').trim().toLowerCase();
}

function hasRiskTerm(values: unknown[]): boolean {
    const normalized = values
        .map((value) => String(value || ''))
        .join(' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    return RISK_TERM.test(normalized);
}

function friendlyName(value: unknown, fallback: string): string {
    const normalized = String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return (normalized || fallback).slice(0, 128);
}

function sceneFriendlyName(value: unknown, fallback: string): string {
    const normalized = friendlyName(value, fallback)
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || fallback;
}

function nested(value: unknown, ...path: string[]): unknown {
    let current = value;
    for (const part of path) {
        if (!isRecord(current)) return undefined;
        current = current[part];
    }
    return current;
}

function brightnessDescriptor(device: Device): {
    code: string;
    dpsId: string;
    minimum: number;
    maximum: number;
    value: unknown;
} | null {
    const status = Array.isArray(device.capabilities.status)
        ? device.capabilities.status
        : [];
    const entry = status.find((candidate) => {
        const code = String(candidate?.code || '').toLowerCase();
        return code === 'bright_value_v2' || code === 'bright_value';
    });
    if (!entry) return null;
    const code = String(entry.code);
    const isV2 = code.toLowerCase().endsWith('_v2');
    return {
        code,
        dpsId: isV2 ? '22' : '3',
        minimum: isV2 ? 10 : 25,
        maximum: isV2 ? 1000 : 255,
        value: entry.value,
    };
}

function finiteOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function roundTemperature(value: number): number {
    return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
