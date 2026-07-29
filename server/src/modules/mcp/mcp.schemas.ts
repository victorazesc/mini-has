import { McpJsonObject, McpProtocolError, MCP_ERROR } from './mcp.types';

export const MCP_DEVICE_COMMANDS = [
    'turn_on',
    'turn_off',
    'toggle',
    'open',
    'close',
    'stop',
    'set_position',
] as const;

export type McpDeviceCommand = typeof MCP_DEVICE_COMMANDS[number];

const EMPTY_INPUT_SCHEMA: McpJsonObject = {
    type: 'object',
    additionalProperties: false,
};

const DEVICE_ID_INPUT_SCHEMA: McpJsonObject = {
    type: 'object',
    properties: {
        deviceId: { type: 'integer', minimum: 1 },
    },
    required: ['deviceId'],
    additionalProperties: false,
};

const SCENE_ID_INPUT_SCHEMA: McpJsonObject = {
    type: 'object',
    properties: {
        sceneId: { type: 'integer', minimum: 1 },
    },
    required: ['sceneId'],
    additionalProperties: false,
};

const CONTROL_DEVICE_INPUT_SCHEMA: McpJsonObject = {
    oneOf: [
        {
            type: 'object',
            properties: {
                deviceId: { type: 'integer', minimum: 1 },
                command: { const: 'set_position' },
                params: {
                    type: 'object',
                    properties: {
                        position: { type: 'number', minimum: 0, maximum: 100 },
                    },
                    required: ['position'],
                    additionalProperties: false,
                },
            },
            required: ['deviceId', 'command', 'params'],
            additionalProperties: false,
        },
        {
            type: 'object',
            properties: {
                deviceId: { type: 'integer', minimum: 1 },
                command: {
                    type: 'string',
                    enum: MCP_DEVICE_COMMANDS.filter((command) => command !== 'set_position'),
                    description: 'Comando domestico suportado pela primeira versao do MCP.',
                },
                params: {
                    type: 'object',
                    maxProperties: 0,
                    additionalProperties: false,
                },
            },
            required: ['deviceId', 'command'],
            additionalProperties: false,
        },
    ],
};

const OUTPUT_SCHEMA: McpJsonObject = {
    type: 'object',
    additionalProperties: true,
};

export const MCP_TOOL_SCHEMAS = {
    listDevices: { input: EMPTY_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
    getDevice: { input: DEVICE_ID_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
    getDeviceStatus: { input: DEVICE_ID_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
    listScenes: { input: EMPTY_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
    controlDevice: { input: CONTROL_DEVICE_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
    runScene: { input: SCENE_ID_INPUT_SCHEMA, output: OUTPUT_SCHEMA },
} as const;

export function parseEmptyArguments(value: unknown): McpJsonObject {
    const args = asObject(value, 'arguments');
    assertOnlyKeys(args, []);
    return args;
}

export function parseDeviceIdArguments(value: unknown): { deviceId: number } {
    const args = asObject(value, 'arguments');
    assertOnlyKeys(args, ['deviceId']);
    return { deviceId: positiveInteger(args.deviceId, 'deviceId') };
}

export function parseSceneIdArguments(value: unknown): { sceneId: number } {
    const args = asObject(value, 'arguments');
    assertOnlyKeys(args, ['sceneId']);
    return { sceneId: positiveInteger(args.sceneId, 'sceneId') };
}

export function parseControlDeviceArguments(value: unknown): {
    deviceId: number;
    command: McpDeviceCommand;
    params: McpJsonObject;
} {
    const args = asObject(value, 'arguments');
    assertOnlyKeys(args, ['deviceId', 'command', 'params']);

    const command = String(args.command || '').trim().toLowerCase();
    if (!MCP_DEVICE_COMMANDS.includes(command as McpDeviceCommand)) {
        invalidParams(`command must be one of: ${MCP_DEVICE_COMMANDS.join(', ')}`);
    }

    const params = args.params === undefined ? {} : asObject(args.params, 'params');
    if (command === 'set_position') {
        assertOnlyKeys(params, ['position']);
        if (
            typeof params.position !== 'number'
            || !Number.isFinite(params.position)
            || params.position < 0
            || params.position > 100
        ) {
            invalidParams('params.position must be a number between 0 and 100');
        }
    } else {
        assertOnlyKeys(params, []);
    }

    return {
        deviceId: positiveInteger(args.deviceId, 'deviceId'),
        command: command as McpDeviceCommand,
        params,
    };
}

export function asObject(value: unknown, field: string): McpJsonObject {
    const normalized = value === undefined ? {} : value;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        invalidParams(`${field} must be an object`);
    }
    return normalized as McpJsonObject;
}

function positiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        invalidParams(`${field} must be a positive integer`);
    }
    return value;
}

function assertOnlyKeys(value: McpJsonObject, allowed: string[]): void {
    const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unexpected.length) invalidParams(`Unexpected arguments: ${unexpected.join(', ')}`);
}

function invalidParams(message: string): never {
    throw new McpProtocolError(MCP_ERROR.invalidParams, message);
}
