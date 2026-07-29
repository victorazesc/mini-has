import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Device, Scene } from '../../types';
import { AUTH_SCOPES_METADATA } from '../auth/auth.decorators';
import { DeviceService } from '../device/device.service';
import { SceneService } from '../scene/scene.service';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { McpAccessContext, MCP_ERROR, MCP_SCOPES } from './mcp.types';

const device: Device = {
    id: 7,
    externalId: 'external-7',
    localDeviceKey: 'sensitive-local-key',
    name: 'Persiana',
    deviceType: 'cover',
    provider: 'mqtt',
    roomId: 2,
    roomName: 'Quarto',
    payload: { password: 'secret', ip: '192.168.1.90' },
    capabilities: { position: true },
    status: { position: 100 },
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
};

const scene: Scene = {
    id: 4,
    name: 'Boa noite',
    actions: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
};

const printer: Device = {
    ...device,
    id: 8,
    name: 'Impressora 3D',
    deviceType: 'printer',
    provider: 'moonraker_local',
};

const camera: Device = {
    ...device,
    id: 9,
    name: 'Camera',
    deviceType: 'camera',
    provider: 'onvif_camera',
};

const alarm: Device = {
    ...device,
    id: 10,
    name: 'Alarme',
    deviceType: 'alarm',
    provider: 'intelbras_amt8000',
};

const additionalBlockedDevices: Device[] = [
    { name: 'Comedouro simples', deviceType: 'feeder' },
    { name: 'Comedouro inteligente', deviceType: 'pet_feeder' },
    { name: 'Hub Zigbee', deviceType: 'hub' },
    { name: 'Controlador IoT', deviceType: 'iot' },
    { name: 'Inversor solar', deviceType: 'solar_inverter' },
    { name: 'Trava externa', deviceType: 'lock' },
    { name: 'Porta social', deviceType: 'gate' },
    { name: 'Garagem', deviceType: 'garage_door' },
    { name: 'Climatizador', deviceType: 'heater' },
    { name: 'Eletrodomestico', deviceType: 'oven' },
    { name: 'Grelha eletrica', deviceType: 'grill' },
    { name: 'Churrasqueira da varanda', deviceType: 'switch' },
    { name: 'Forno da cozinha', deviceType: 'switch' },
    { name: 'Aquecedor do quarto', deviceType: 'switch' },
    { name: 'Portão principal', deviceType: 'switch' },
    { name: 'Fechadura da entrada', deviceType: 'switch' },
].map((blocked, index) => ({
    ...device,
    ...blocked,
    id: 11 + index,
}));

const blockedDevices = [printer, camera, alarm, ...additionalBlockedDevices];

const sensitiveScenes: Scene[] = blockedDevices.map((sensitiveDevice, index) => ({
    ...scene,
    id: 100 + index,
    name: `Sensitive ${sensitiveDevice.deviceType}`,
    actions: [{
        id: 200 + index,
        sceneId: 100 + index,
        deviceId: sensitiveDevice.id,
        deviceName: sensitiveDevice.name,
        deviceType: sensitiveDevice.deviceType,
        orderIndex: 1,
        command: 'turn_on',
        params: {},
        createdAt: scene.createdAt,
        updatedAt: scene.updatedAt,
    }],
}));

function access(...scopes: string[]): McpAccessContext {
    return {
        subject: 'user-1',
        clientId: 'test-client',
        scopes: new Set([MCP_SCOPES.connect, ...scopes]),
    };
}

function createService() {
    const calls: Array<{ deviceId: number; command: string; params: unknown }> = [];
    const sceneCalls: number[] = [];
    const allDevices = [device, ...blockedDevices];
    const allScenes = [scene, ...sensitiveScenes];
    const devices = {
        listDevices: () => allDevices,
        getDevice: (deviceId: number) => allDevices.find((item) => item.id === deviceId) || null,
        deviceStatus: async (deviceId: number) => deviceId === device.id
            ? {
                device,
                query: {
                    ok: true,
                    status: 'ok',
                    message: 'updated',
                    result: { token: 'must-not-leak', position: 100 },
                },
            }
            : null,
        commandDevice: async (deviceId: number, request: { command: string; params?: unknown }) => {
            calls.push({ deviceId, command: request.command, params: request.params });
            return deviceId === device.id
                ? { ok: true, status: 'sent', message: 'ok', result: { position: 50 } }
                : null;
        },
    } as unknown as DeviceService;
    const scenes = {
        listScenes: () => allScenes,
        getScene: (sceneId: number) => allScenes.find((item) => item.id === sceneId) || null,
        runScene: async (sceneId: number) => {
            sceneCalls.push(sceneId);
            return allScenes.some((item) => item.id === sceneId)
                ? { id: 10, sceneId, status: 'success', summary: {}, createdAt: '2026-07-28T00:00:00.000Z' }
                : null;
        },
    } as unknown as SceneService;

    return { service: new McpService(devices, scenes), calls, sceneCalls };
}

test('filters read and control tools by scope', () => {
    const { service } = createService();
    const names = service.listTools(access(MCP_SCOPES.devicesRead, MCP_SCOPES.scenesRead))
        .map((tool) => tool.name);

    assert.deepEqual(names, ['list_devices', 'get_device', 'get_device_status', 'list_scenes']);
    assert.equal(names.includes('control_device'), false);
    assert.equal(names.includes('run_scene'), false);
});

test('requires the complete useful MCP scope bundle at the HTTP guard', () => {
    const scopes = Reflect.getMetadata(AUTH_SCOPES_METADATA, McpController);
    assert.deepEqual(scopes, [
        MCP_SCOPES.connect,
        MCP_SCOPES.devicesRead,
        MCP_SCOPES.devicesControl,
        MCP_SCOPES.scenesRead,
        MCP_SCOPES.scenesRun,
    ]);
});

test('does not expose device payload or command secrets in read tools', async () => {
    const { service } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_device_status', arguments: { deviceId: 7 } },
    }, access(MCP_SCOPES.devicesRead));

    assert.equal(response?.error, undefined);
    const serialized = JSON.stringify(response?.result);
    assert.equal(serialized.includes('sensitive-local-key'), false);
    assert.equal(serialized.includes('must-not-leak'), false);
    assert.equal(serialized.includes('external-7'), false);
});

test('keeps blocked device categories available to read tools', async () => {
    const { service } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'read-blocked',
        method: 'tools/call',
        params: { name: 'list_devices', arguments: {} },
    }, access(MCP_SCOPES.devicesRead));

    const serialized = JSON.stringify(response?.result);
    assert.equal(response?.error, undefined);
    assert.equal(serialized.includes('Comedouro inteligente'), true);
    assert.equal(serialized.includes('Inversor solar'), true);
    assert.equal(serialized.includes('Churrasqueira da varanda'), true);
    assert.equal(serialized.includes('Fechadura da entrada'), true);
});

test('denies control without devices:control and does not call DeviceService', async () => {
    const { service, calls } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
            name: 'control_device',
            arguments: { deviceId: 7, command: 'set_position', params: { position: 50 } },
        },
    }, access(MCP_SCOPES.devicesRead));

    assert.equal(response?.error?.code, MCP_ERROR.unauthorized);
    assert.equal(calls.length, 0);
});

test('validates and delegates safe control commands to DeviceService', async () => {
    const { service, calls } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
            name: 'control_device',
            arguments: { deviceId: 7, command: 'set_position', params: { position: 50 } },
        },
    }, access(MCP_SCOPES.devicesControl));

    assert.equal(response?.error, undefined);
    assert.deepEqual(calls, [{ deviceId: 7, command: 'set_position', params: { position: 50 } }]);

    const rejected = await service.handleMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
            name: 'control_device',
            arguments: { deviceId: 7, command: 'calibrate_zero' },
        },
    }, access(MCP_SCOPES.devicesControl));

    assert.equal(rejected?.error, undefined);
    assert.equal((rejected?.result as { isError?: boolean } | undefined)?.isError, true);
    assert.equal(calls.length, 1);
});

test('strictly validates set_position and rejects generic commands', async () => {
    const { service, calls } = createService();
    for (const [command, params] of [
        ['set_position', { position: -1 }],
        ['set_position', { position: 101 }],
        ['set_position', { position: '50' }],
        ['set_position', { position: 50, payload: 'unsafe' }],
        ['set', { value: true }],
        ['pause', {}],
        ['resume', {}],
    ] as Array<[string, Record<string, unknown>]>) {
        const response = await service.handleMessage({
            jsonrpc: '2.0',
            id: command,
            method: 'tools/call',
            params: {
                name: 'control_device',
                arguments: { deviceId: 7, command, params },
            },
        }, access(MCP_SCOPES.devicesControl));
        assert.equal(response?.error, undefined);
        assert.equal((response?.result as { isError?: boolean } | undefined)?.isError, true);
    }
    assert.equal(calls.length, 0);

    const lowerBound = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'lower',
        method: 'tools/call',
        params: {
            name: 'control_device',
            arguments: { deviceId: 7, command: 'set_position', params: { position: 0 } },
        },
    }, access(MCP_SCOPES.devicesControl));
    const upperBound = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'upper',
        method: 'tools/call',
        params: {
            name: 'control_device',
            arguments: { deviceId: 7, command: 'set_position', params: { position: 100 } },
        },
    }, access(MCP_SCOPES.devicesControl));

    assert.equal(lowerBound?.error, undefined);
    assert.equal(upperBound?.error, undefined);
    assert.equal(calls.length, 2);
});

test('keeps unknown tools as JSON-RPC protocol errors', async () => {
    const { service } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'unknown-tool',
        method: 'tools/call',
        params: { name: 'unknown_tool', arguments: {} },
    }, access(MCP_SCOPES.devicesRead));

    assert.equal(response?.error?.code, MCP_ERROR.invalidParams);
    assert.equal(response?.result, undefined);
});

test('blocks sensitive device types and names before command dispatch', async () => {
    const { service, calls } = createService();
    for (const sensitiveDevice of blockedDevices) {
        const response = await service.handleMessage({
            jsonrpc: '2.0',
            id: sensitiveDevice.id,
            method: 'tools/call',
            params: {
                name: 'control_device',
                arguments: { deviceId: sensitiveDevice.id, command: 'turn_on' },
            },
        }, access(MCP_SCOPES.devicesControl));

        const result = response?.result as { isError?: boolean } | undefined;
        assert.equal(response?.error, undefined);
        assert.equal(result?.isError, true);
    }
    assert.equal(calls.length, 0);
});

test('blocks scenes that target sensitive device types or names before SceneService.runScene', async () => {
    const { service, sceneCalls } = createService();
    for (const sensitiveScene of sensitiveScenes) {
        const response = await service.handleMessage({
            jsonrpc: '2.0',
            id: sensitiveScene.id,
            method: 'tools/call',
            params: {
                name: 'run_scene',
                arguments: { sceneId: sensitiveScene.id },
            },
        }, access(MCP_SCOPES.scenesRun));

        const result = response?.result as { isError?: boolean } | undefined;
        assert.equal(response?.error, undefined);
        assert.equal(result?.isError, true);
    }
    assert.equal(sceneCalls.length, 0);
});

test('reads validated device resources through DeviceService', async () => {
    const { service } = createService();
    const response = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'resource-1',
        method: 'resources/read',
        params: { uri: 'mini-has://devices/7' },
    }, access(MCP_SCOPES.devicesRead));

    assert.equal(response?.error, undefined);
    assert.equal(JSON.stringify(response?.result).includes('Persiana'), true);

    const missing = await service.handleMessage({
        jsonrpc: '2.0',
        id: 'resource-2',
        method: 'resources/read',
        params: { uri: 'mini-has://devices/999' },
    }, access(MCP_SCOPES.devicesRead));

    assert.equal(missing?.error?.code, MCP_ERROR.resourceNotFound);
});
