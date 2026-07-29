import { Injectable } from '@nestjs/common';
import { Device, JsonObject, Scene } from '../../types';
import { DeviceService } from '../device/device.service';
import { SceneService } from '../scene/scene.service';
import {
    MCP_TOOL_SCHEMAS,
    asObject,
    parseControlDeviceArguments,
    parseDeviceIdArguments,
    parseEmptyArguments,
    parseSceneIdArguments,
} from './mcp.schemas';
import {
    McpAccessContext,
    McpJsonObject,
    McpJsonRpcRequest,
    McpJsonRpcResponse,
    McpProtocolError,
    McpRequestId,
    McpScope,
    McpToolDefinition,
    McpToolResult,
    MCP_ERROR,
    MCP_PROTOCOL_VERSION,
    MCP_SCOPES,
} from './mcp.types';

const DEVICE_RESOURCE_URI = 'mini-has://devices';
const SCENE_RESOURCE_URI = 'mini-has://scenes';
const DEVICE_RESOURCE_PATTERN = /^mini-has:\/\/devices\/([1-9]\d*)$/;
const SCENE_RESOURCE_PATTERN = /^mini-has:\/\/scenes\/([1-9]\d*)$/;
const BLOCKED_CONTROL_TYPES = [
    'printer',
    'camera',
    'alarm',
    'security_panel',
    'siren',
    'feeder',
    'pet_feeder',
    'hub',
    'iot',
    'solar',
    'lock',
    'gate',
    'garage',
    'heater',
    'oven',
    'grill',
];
const BLOCKED_CONTROL_PROVIDERS = ['moonraker', 'klipper', 'onvif', 'amt8000'];
const BLOCKED_CONTROL_NAME_TERMS = [
    'churrasqueira',
    'forno',
    'aquecedor',
    'portao',
    'fechadura',
];

interface RegisteredTool {
    definition: McpToolDefinition;
    requiredScope: McpScope;
}

const TOOLS: RegisteredTool[] = [
    {
        requiredScope: MCP_SCOPES.devicesRead,
        definition: toolDefinition(
            'list_devices',
            'Listar dispositivos',
            'Lista os dispositivos do mini-has sem credenciais ou configuracoes sensiveis.',
            MCP_TOOL_SCHEMAS.listDevices,
            true,
        ),
    },
    {
        requiredScope: MCP_SCOPES.devicesRead,
        definition: toolDefinition(
            'get_device',
            'Consultar dispositivo',
            'Consulta metadados, capacidades e o ultimo estado conhecido de um dispositivo.',
            MCP_TOOL_SCHEMAS.getDevice,
            true,
        ),
    },
    {
        requiredScope: MCP_SCOPES.devicesRead,
        definition: toolDefinition(
            'get_device_status',
            'Atualizar status do dispositivo',
            'Consulta o dispositivo pelo servico existente e retorna seu estado atualizado.',
            MCP_TOOL_SCHEMAS.getDeviceStatus,
            true,
        ),
    },
    {
        requiredScope: MCP_SCOPES.scenesRead,
        definition: toolDefinition(
            'list_scenes',
            'Listar cenas',
            'Lista as cenas configuradas e suas acoes.',
            MCP_TOOL_SCHEMAS.listScenes,
            true,
        ),
    },
    {
        requiredScope: MCP_SCOPES.devicesControl,
        definition: toolDefinition(
            'control_device',
            'Controlar dispositivo',
            'Executa um comando seguro no dispositivo pelo DeviceService.',
            MCP_TOOL_SCHEMAS.controlDevice,
            false,
        ),
    },
    {
        requiredScope: MCP_SCOPES.scenesRun,
        definition: toolDefinition(
            'run_scene',
            'Executar cena',
            'Executa uma cena configurada pelo SceneService.',
            MCP_TOOL_SCHEMAS.runScene,
            false,
        ),
    },
];

@Injectable()
export class McpService {
    constructor(
        private readonly devices: DeviceService,
        private readonly scenes: SceneService,
    ) { }

    async handleMessage(rawRequest: unknown, access: McpAccessContext): Promise<McpJsonRpcResponse | null> {
        let requestId: McpRequestId = null;

        try {
            this.requireScope(access, MCP_SCOPES.connect);
            const request = parseRequest(rawRequest);
            requestId = request.id ?? null;

            if (request.id === undefined) {
                this.acceptNotification(request);
                return null;
            }

            const result = await this.dispatch(request, access);
            return { jsonrpc: '2.0', id: requestId, result };
        } catch (error) {
            if (error instanceof McpProtocolError) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: { code: error.code, message: error.message, data: error.data },
                };
            }

            return {
                jsonrpc: '2.0',
                id: requestId,
                error: { code: MCP_ERROR.internal, message: 'Internal MCP error' },
            };
        }
    }

    listTools(access: McpAccessContext): McpToolDefinition[] {
        return TOOLS
            .filter((tool) => access.scopes.has(tool.requiredScope))
            .map((tool) => tool.definition);
    }

    private async dispatch(request: McpJsonRpcRequest, access: McpAccessContext): Promise<McpJsonObject> {
        switch (request.method) {
            case 'initialize':
                return this.initialize(request.params);
            case 'ping':
                return {};
            case 'tools/list':
                assertListParams(request.params);
                return { tools: this.listTools(access) };
            case 'tools/call':
                return this.callTool(request.params, access);
            case 'resources/list':
                assertListParams(request.params);
                return { resources: this.listResources(access) };
            case 'resources/templates/list':
                assertListParams(request.params);
                return { resourceTemplates: this.listResourceTemplates(access) };
            case 'resources/read':
                return this.readResource(request.params, access);
            default:
                throw new McpProtocolError(MCP_ERROR.methodNotFound, `Method not found: ${request.method}`);
        }
    }

    private initialize(params: McpJsonObject | undefined): McpJsonObject {
        const value = asObject(params, 'params');
        if (typeof value.protocolVersion !== 'string' || !value.protocolVersion.trim()) {
            throw new McpProtocolError(MCP_ERROR.invalidParams, 'protocolVersion is required');
        }
        if (!value.clientInfo || typeof value.clientInfo !== 'object' || Array.isArray(value.clientInfo)) {
            throw new McpProtocolError(MCP_ERROR.invalidParams, 'clientInfo is required');
        }

        return {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                resources: {},
                tools: {},
            },
            serverInfo: {
                name: 'mini-has',
                version: '1.0.0',
            },
            instructions: 'Use resources for context. Read tools never control devices; control tools require explicit scopes.',
        };
    }

    private acceptNotification(request: McpJsonRpcRequest): void {
        if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return;
        if (!request.method.startsWith('notifications/')) {
            throw new McpProtocolError(MCP_ERROR.invalidRequest, 'Requests must include an id');
        }
    }

    private listResources(access: McpAccessContext): McpJsonObject[] {
        const resources: McpJsonObject[] = [];
        if (access.scopes.has(MCP_SCOPES.devicesRead)) {
            resources.push({
                uri: DEVICE_RESOURCE_URI,
                name: 'devices',
                title: 'Dispositivos do mini-has',
                description: 'Lista segura de dispositivos, capacidades e estados.',
                mimeType: 'application/json',
            });
        }
        if (access.scopes.has(MCP_SCOPES.scenesRead)) {
            resources.push({
                uri: SCENE_RESOURCE_URI,
                name: 'scenes',
                title: 'Cenas do mini-has',
                description: 'Cenas configuradas e suas acoes.',
                mimeType: 'application/json',
            });
        }
        return resources;
    }

    private listResourceTemplates(access: McpAccessContext): McpJsonObject[] {
        const templates: McpJsonObject[] = [];
        if (access.scopes.has(MCP_SCOPES.devicesRead)) {
            templates.push({
                uriTemplate: `${DEVICE_RESOURCE_URI}/{deviceId}`,
                name: 'device',
                title: 'Dispositivo do mini-has',
                description: 'Metadados e ultimo estado conhecido de um dispositivo.',
                mimeType: 'application/json',
            });
        }
        if (access.scopes.has(MCP_SCOPES.scenesRead)) {
            templates.push({
                uriTemplate: `${SCENE_RESOURCE_URI}/{sceneId}`,
                name: 'scene',
                title: 'Cena do mini-has',
                description: 'Definicao de uma cena configurada.',
                mimeType: 'application/json',
            });
        }
        return templates;
    }

    private readResource(params: McpJsonObject | undefined, access: McpAccessContext): McpJsonObject {
        const value = asObject(params, 'params');
        if (typeof value.uri !== 'string' || !value.uri.trim()) {
            throw new McpProtocolError(MCP_ERROR.invalidParams, 'uri is required');
        }
        const uri = value.uri.trim();

        if (uri === DEVICE_RESOURCE_URI) {
            this.requireScope(access, MCP_SCOPES.devicesRead);
            return resourceContents(uri, { devices: this.devices.listDevices().map(publicDevice) });
        }
        if (uri === SCENE_RESOURCE_URI) {
            this.requireScope(access, MCP_SCOPES.scenesRead);
            return resourceContents(uri, { scenes: this.scenes.listScenes().map(publicScene) });
        }

        const deviceMatch = DEVICE_RESOURCE_PATTERN.exec(uri);
        if (deviceMatch) {
            this.requireScope(access, MCP_SCOPES.devicesRead);
            const device = this.devices.getDevice(Number(deviceMatch[1]));
            if (!device) throw resourceNotFound(uri);
            return resourceContents(uri, { device: publicDevice(device) });
        }

        const sceneMatch = SCENE_RESOURCE_PATTERN.exec(uri);
        if (sceneMatch) {
            this.requireScope(access, MCP_SCOPES.scenesRead);
            const scene = this.scenes.getScene(Number(sceneMatch[1]));
            if (!scene) throw resourceNotFound(uri);
            return resourceContents(uri, { scene: publicScene(scene) });
        }

        throw resourceNotFound(uri);
    }

    private async callTool(params: McpJsonObject | undefined, access: McpAccessContext): Promise<McpToolResult> {
        const value = asObject(params, 'params');
        if (typeof value.name !== 'string' || !value.name.trim()) {
            throw new McpProtocolError(MCP_ERROR.invalidParams, 'Tool name is required');
        }
        const name = value.name.trim();
        const tool = TOOLS.find((item) => item.definition.name === name);
        if (!tool) throw new McpProtocolError(MCP_ERROR.invalidParams, `Unknown tool: ${name}`);
        this.requireScope(access, tool.requiredScope);

        try {
            return await this.executeTool(name, value.arguments, access);
        } catch (error) {
            if (error instanceof McpProtocolError) {
                if (error.code === MCP_ERROR.invalidParams) return toolError(error.message);
                throw error;
            }
            return toolError(messageFrom(error));
        }
    }

    private async executeTool(name: string, args: unknown, access: McpAccessContext): Promise<McpToolResult> {
        if (name === 'list_devices') {
            parseEmptyArguments(args);
            return toolSuccess({ devices: this.devices.listDevices().map(publicDevice) });
        }

        if (name === 'get_device') {
            const { deviceId } = parseDeviceIdArguments(args);
            const device = this.devices.getDevice(deviceId);
            return device
                ? toolSuccess({ device: publicDevice(device) })
                : toolError(`Device not found: ${deviceId}`);
        }

        if (name === 'get_device_status') {
            const { deviceId } = parseDeviceIdArguments(args);
            const status = await this.devices.deviceStatus(deviceId);
            if (!status) return toolError(`Device not found: ${deviceId}`);
            return toolSuccess({
                device: publicDevice(status.device),
                query: publicCommandResult(status.query),
            }, status.query.ok !== false);
        }

        if (name === 'list_scenes') {
            parseEmptyArguments(args);
            return toolSuccess({ scenes: this.scenes.listScenes().map(publicScene) });
        }

        if (name === 'control_device') {
            const { deviceId, command, params } = parseControlDeviceArguments(args);
            const device = this.devices.getDevice(deviceId);
            if (!device) return toolError(`Device not found: ${deviceId}`);
            if (isSensitiveControlDevice(device)) {
                return toolError(`MCP control is blocked for device type: ${device.deviceType}`);
            }
            const result = await this.devices.commandDevice(deviceId, { command, params: params as JsonObject });
            if (!result) return toolError(`Device unavailable: ${deviceId}`);
            return toolSuccess({
                deviceId,
                device: optionalPublicDevice(this.devices.getDevice(deviceId)),
                result: publicCommandResult(result),
            }, result.ok !== false);
        }

        if (name === 'run_scene') {
            const { sceneId } = parseSceneIdArguments(args);
            const scene = this.scenes.getScene(sceneId);
            if (!scene) return toolError(`Scene not found: ${sceneId}`);
            const blockedDevice = scene.actions
                .map((action) => this.devices.getDevice(action.deviceId))
                .find((device): device is Device => Boolean(device && isSensitiveControlDevice(device)));
            if (blockedDevice) {
                return toolError(
                    `MCP scene execution is blocked because it controls ${blockedDevice.deviceType}: ${blockedDevice.name}`,
                );
            }
            const run = await this.scenes.runScene(sceneId, {
                source: 'mcp',
                subject: access.subject,
                clientId: access.clientId,
            });
            if (!run) return toolError(`Scene unavailable: ${sceneId}`);
            return toolSuccess({ sceneId, run: sanitizeValue(run) as McpJsonObject }, run.status !== 'error');
        }

        throw new McpProtocolError(MCP_ERROR.invalidParams, `Unknown tool: ${name}`);
    }

    private requireScope(access: McpAccessContext, scope: McpScope): void {
        if (!access.scopes.has(scope)) {
            throw new McpProtocolError(MCP_ERROR.unauthorized, `Missing required scope: ${scope}`);
        }
    }
}

function parseRequest(value: unknown): McpJsonRpcRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new McpProtocolError(MCP_ERROR.invalidRequest, 'JSON-RPC request must be an object');
    }
    const request = value as Record<string, unknown>;
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || !request.method.trim()) {
        throw new McpProtocolError(MCP_ERROR.invalidRequest, 'Invalid JSON-RPC request');
    }
    if (
        request.id !== undefined
        && request.id !== null
        && typeof request.id !== 'string'
        && (typeof request.id !== 'number' || !Number.isFinite(request.id))
    ) {
        throw new McpProtocolError(MCP_ERROR.invalidRequest, 'Invalid JSON-RPC id');
    }
    if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) {
        throw new McpProtocolError(MCP_ERROR.invalidParams, 'params must be an object');
    }
    return request as unknown as McpJsonRpcRequest;
}

function assertListParams(params: McpJsonObject | undefined): void {
    const value = asObject(params, 'params');
    const unexpected = Object.keys(value).filter((key) => key !== 'cursor');
    if (unexpected.length) {
        throw new McpProtocolError(MCP_ERROR.invalidParams, `Unexpected params: ${unexpected.join(', ')}`);
    }
    if (value.cursor !== undefined && typeof value.cursor !== 'string') {
        throw new McpProtocolError(MCP_ERROR.invalidParams, 'cursor must be a string');
    }
}

function toolDefinition(
    name: string,
    title: string,
    description: string,
    schemas: { input: McpJsonObject; output: McpJsonObject },
    readOnly: boolean,
): McpToolDefinition {
    return {
        name,
        title,
        description,
        inputSchema: schemas.input,
        outputSchema: schemas.output,
        annotations: {
            readOnlyHint: readOnly,
            destructiveHint: !readOnly,
            idempotentHint: readOnly,
            openWorldHint: false,
        },
    };
}

function resourceContents(uri: string, value: McpJsonObject): McpJsonObject {
    return {
        contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(value),
        }],
    };
}

function resourceNotFound(uri: string): McpProtocolError {
    return new McpProtocolError(MCP_ERROR.resourceNotFound, 'Resource not found', { uri });
}

function toolSuccess(value: McpJsonObject, ok = true): McpToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
        isError: !ok,
    };
}

function toolError(message: string): McpToolResult {
    const value = { error: message };
    return {
        content: [{ type: 'text', text: message }],
        structuredContent: value,
        isError: true,
    };
}

function publicDevice(device: Device): McpJsonObject {
    return sanitizeValue({
        id: device.id,
        name: device.name,
        deviceType: device.deviceType,
        provider: device.provider,
        roomId: device.roomId,
        roomName: device.roomName,
        capabilities: device.capabilities,
        status: device.status,
        updatedAt: device.updatedAt,
    }) as McpJsonObject;
}

function optionalPublicDevice(device: Device | null): McpJsonObject | null {
    return device ? publicDevice(device) : null;
}

function publicScene(scene: Scene): McpJsonObject {
    return sanitizeValue(scene) as McpJsonObject;
}

function publicCommandResult(result: unknown): unknown {
    return sanitizeValue(result);
}

function sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !isSensitiveKey(key))
            .map(([key, item]) => [key, sanitizeValue(item)]),
    );
}

function isSensitiveKey(key: string): boolean {
    const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
    return [
        'password',
        'passphrase',
        'secret',
        'token',
        'accesstoken',
        'refreshtoken',
        'authorization',
        'credential',
        'credentials',
        'apikey',
        'localkey',
    ].includes(normalized);
}

function isSensitiveControlDevice(device: Device): boolean {
    const deviceType = String(device.deviceType || '').trim().toLowerCase();
    const provider = String(device.provider || '').trim().toLowerCase();
    const name = normalizeSearchText(device.name);
    return BLOCKED_CONTROL_TYPES.some((blocked) => deviceType === blocked || deviceType.includes(blocked))
        || BLOCKED_CONTROL_PROVIDERS.some((blocked) => provider.includes(blocked))
        || BLOCKED_CONTROL_NAME_TERMS.some((blocked) => name.includes(blocked));
}

function normalizeSearchText(value: unknown): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function messageFrom(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Tool execution failed';
}
