import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Device, Scene } from '../../types';
import { DeviceService } from '../device/device.service';
import { SceneService } from '../scene/scene.service';
import {
    alexaAllowedDeviceIds,
    isAlexaControllableDevice,
    isAlexaRiskDevice,
    isAlexaSafeScene,
} from './alexa.mapper';
import { AlexaService } from './alexa.service';
import { AlexaDirective } from './alexa.types';

const previousAllowedIds = process.env.ALEXA_ALLOWED_DEVICE_IDS;

afterEach(() => {
    if (previousAllowedIds === undefined) delete process.env.ALEXA_ALLOWED_DEVICE_IDS;
    else process.env.ALEXA_ALLOWED_DEVICE_IDS = previousAllowedIds;
});

test('keeps lights, covers and air conditioners enabled by default', () => {
    assert.equal(isAlexaControllableDevice(device(1, 'Luz da sala', 'light')), true);
    assert.equal(isAlexaControllableDevice(device(2, 'Persiana', 'cover')), true);
    assert.equal(
        isAlexaControllableDevice(device(3, 'Ar-condicionado', 'climate')),
        true,
    );
});

test('blocks dangerous types and obvious risk names by default', () => {
    for (const [id, name, type] of [
        [1, 'Mainsail', 'printer'],
        [2, 'Câmera frente', 'camera'],
        [3, 'Alarme', 'alarm'],
        [4, 'Alimentador', 'feeder'],
        [5, 'Churrasqueira', 'switch'],
        [6, 'Portão social', 'cover'],
        [7, 'Aquecedor', 'switch'],
        [8, 'Fechadura', 'switch'],
    ] as Array<[number, string, string]>) {
        const candidate = device(id, name, type);
        assert.equal(isAlexaRiskDevice(candidate), true);
        assert.equal(isAlexaControllableDevice(candidate), false);
    }
});

test('allows explicit opt-in only for a supported controller type', () => {
    const allowed = alexaAllowedDeviceIds('5, 9;invalid');
    assert.equal(
        isAlexaControllableDevice(device(5, 'Churrasqueira', 'switch'), allowed),
        true,
    );
    assert.equal(
        isAlexaControllableDevice(device(9, 'Mainsail', 'printer'), allowed),
        false,
    );
});

test('never allows scenes that target a risky device', () => {
    const safeLight = device(1, 'Luz da sala', 'light');
    const riskySwitch = device(2, 'Churrasqueira', 'switch');
    const safe = scene(1, [{ deviceId: 1, command: 'turn_on' }]);
    const risky = scene(2, [{ deviceId: 2, command: 'turn_on' }]);

    assert.equal(isAlexaSafeScene(safe, (id) => id === 1 ? safeLight : null), true);
    assert.equal(isAlexaSafeScene(risky, (id) => id === 2 ? riskySwitch : null), false);
});

test('discovery omits risky devices and scenes but preserves safe endpoints', async () => {
    const safeLight = device(1, 'Luz da sala', 'light');
    const riskySwitch = device(2, 'Churrasqueira', 'switch');
    const airConditioner = device(3, 'Ar-condicionado', 'climate');
    const sceneSafe = scene(1, [{ deviceId: 1, command: 'turn_on' }]);
    const sceneRisky = scene(2, [{ deviceId: 2, command: 'turn_on' }]);
    const alexa = service(
        [safeLight, riskySwitch, airConditioner],
        [sceneSafe, sceneRisky],
    );

    const response = await alexa.handleDirective(discoveryDirective());
    const endpointIds = response.event.payload.endpoints.map(
        (endpoint: { endpointId: string }) => endpoint.endpointId,
    );

    assert.deepEqual(endpointIds, [
        'mini-has-device-1',
        'mini-has-device-3',
        'mini-has-scene-1',
    ]);
});

test('control rejects risky devices unless explicitly allowed', async () => {
    const riskySwitch = device(5, 'Churrasqueira', 'switch');
    let commandCount = 0;
    const alexa = service([riskySwitch], [], async () => {
        commandCount += 1;
        return { ok: true, status: 'success', message: '', result: {} };
    });

    const denied = await alexa.handleDirective(powerDirective(5));
    assert.equal(denied.event.header.name, 'ErrorResponse');
    assert.equal(denied.event.payload.type, 'NO_SUCH_ENDPOINT');
    assert.equal(commandCount, 0);

    process.env.ALEXA_ALLOWED_DEVICE_IDS = '5';
    const allowed = await alexa.handleDirective(powerDirective(5));
    assert.equal(allowed.event.header.name, 'Response');
    assert.equal(commandCount, 1);
});

test('scene execution revalidates risk and never calls runScene', async () => {
    const riskySwitch = device(2, 'Churrasqueira', 'switch');
    const riskyScene = scene(2, [{ deviceId: 2, command: 'turn_on' }]);
    let runCount = 0;
    const alexa = service([riskySwitch], [riskyScene], undefined, async () => {
        runCount += 1;
        return {
            id: 1,
            sceneId: 2,
            status: 'success',
            summary: {},
            createdAt: new Date().toISOString(),
        };
    });

    const response = await alexa.handleDirective(sceneDirective(2));

    assert.equal(response.event.header.name, 'ErrorResponse');
    assert.equal(response.event.payload.type, 'NO_SUCH_ENDPOINT');
    assert.equal(runCount, 0);
});

function service(
    devices: Device[],
    scenes: Scene[],
    commandDevice?: (...args: unknown[]) => Promise<unknown>,
    runScene?: (...args: unknown[]) => Promise<unknown>,
): AlexaService {
    const byDeviceId = new Map(devices.map((item) => [item.id, item]));
    const bySceneId = new Map(scenes.map((item) => [item.id, item]));
    const deviceService = {
        listDevices: () => devices,
        getDevice: (id: number) => byDeviceId.get(id) || null,
        commandDevice: commandDevice || (async () => null),
        deviceStatus: async (id: number) => ({
            device: byDeviceId.get(id),
            query: { ok: true },
        }),
    } as unknown as DeviceService;
    const sceneService = {
        listScenes: () => scenes,
        getScene: (id: number) => bySceneId.get(id) || null,
        runScene: runScene || (async () => null),
    } as unknown as SceneService;
    return new AlexaService(deviceService, sceneService);
}

function device(id: number, name: string, deviceType: string): Device {
    return {
        id,
        externalId: `device-${id}`,
        name,
        deviceType,
        provider: 'test',
        payload: {},
        capabilities: {},
        status: { online: true, state: 'off' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function scene(
    id: number,
    actions: Array<{ deviceId: number; command: string }>,
): Scene {
    return {
        id,
        name: `Cena ${id}`,
        actions: actions.map((action, index) => ({
            id: index + 1,
            sceneId: id,
            deviceId: action.deviceId,
            orderIndex: index,
            command: action.command,
            params: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        })),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

function discoveryDirective(): AlexaDirective {
    return {
        header: {
            namespace: 'Alexa.Discovery',
            name: 'Discover',
            messageId: 'discovery',
            payloadVersion: '3',
        },
        payload: {},
    };
}
function powerDirective(deviceId: number): AlexaDirective {
    return {
        header: {
            namespace: 'Alexa.PowerController',
            name: 'TurnOn',
            messageId: 'power',
            correlationToken: 'correlation',
            payloadVersion: '3',
        },
        endpoint: {
            endpointId: `mini-has-device-${deviceId}`,
        },
        payload: {},
    };
}

function sceneDirective(sceneId: number): AlexaDirective {
    return {
        header: {
            namespace: 'Alexa.SceneController',
            name: 'Activate',
            messageId: 'scene',
            correlationToken: 'correlation',
            payloadVersion: '3',
        },
        endpoint: {
            endpointId: `mini-has-scene-${sceneId}`,
        },
        payload: {},
    };
}
