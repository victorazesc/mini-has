import { timingSafeEqual } from 'node:crypto';
import { JsonObject } from '../../types';
import {
    AlexaDirective,
    AlexaEndpointReference,
    AlexaEndpointTarget,
    AlexaHeader,
    AlexaScope,
} from './alexa.types';

const DEVICE_ENDPOINT_PREFIX = 'mini-has-device-';
const SCENE_ENDPOINT_PREFIX = 'mini-has-scene-';

export class AlexaSchemaError extends Error {
    constructor() {
        super('Invalid Alexa directive');
        this.name = 'AlexaSchemaError';
    }
}

export function parseAlexaDirective(input: unknown): AlexaDirective {
    const root = record(input);
    const rawDirective = record(root.directive);
    const rawHeader = record(rawDirective.header);
    const payloadVersion = string(rawHeader.payloadVersion, 8);
    if (!/^3(?:\.\d+)?$/.test(payloadVersion)) throw new AlexaSchemaError();

    const header: AlexaHeader = {
        namespace: string(rawHeader.namespace, 128),
        name: string(rawHeader.name, 128),
        messageId: string(rawHeader.messageId, 256),
        payloadVersion,
    };

    const correlationToken = optionalString(rawHeader.correlationToken, 4_096);
    const instance = optionalString(rawHeader.instance, 256);
    if (correlationToken) header.correlationToken = correlationToken;
    if (instance) header.instance = instance;

    const directive: AlexaDirective = {
        header,
        payload: jsonObject(rawDirective.payload),
    };

    if (rawDirective.endpoint !== undefined) {
        directive.endpoint = parseEndpoint(rawDirective.endpoint);
    }
    return directive;
}

export function directiveAccessToken(directive: AlexaDirective): string | null {
    const endpointToken = directive.endpoint?.scope?.token;
    if (endpointToken) return endpointToken;

    const rawScope = directive.payload.scope;
    if (!isRecord(rawScope) || rawScope.type !== 'BearerToken') return null;
    return typeof rawScope.token === 'string' && rawScope.token.length <= 8_192
        ? rawScope.token
        : null;
}

export function requiredScopesForDirective(directive: AlexaDirective): string[] {
    const { namespace, name } = directive.header;

    if (namespace === 'Alexa.Discovery' && name === 'Discover') {
        return ['devices:read', 'scenes:read'];
    }
    if (namespace === 'Alexa' && name === 'ReportState') {
        return ['devices:read'];
    }
    if (namespace === 'Alexa.SceneController') {
        return ['scenes:run'];
    }
    if ([
        'Alexa.PowerController',
        'Alexa.BrightnessController',
        'Alexa.PercentageController',
        'Alexa.RangeController',
        'Alexa.ThermostatController',
    ].includes(namespace)) {
        return ['devices:control'];
    }
    return ['devices:read'];
}

export function safeTokenEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length
        && timingSafeEqual(leftBuffer, rightBuffer);
}

export function deviceEndpointId(deviceId: number): string {
    return `${DEVICE_ENDPOINT_PREFIX}${deviceId}`;
}

export function sceneEndpointId(sceneId: number): string {
    return `${SCENE_ENDPOINT_PREFIX}${sceneId}`;
}

export function parseEndpointTarget(endpointId: string): AlexaEndpointTarget | null {
    const deviceId = positiveIntegerSuffix(endpointId, DEVICE_ENDPOINT_PREFIX);
    if (deviceId !== null) return { kind: 'device', id: deviceId };

    const sceneId = positiveIntegerSuffix(endpointId, SCENE_ENDPOINT_PREFIX);
    return sceneId === null ? null : { kind: 'scene', id: sceneId };
}

function parseEndpoint(input: unknown): AlexaEndpointReference {
    const rawEndpoint = record(input);
    const endpoint: AlexaEndpointReference = {
        endpointId: string(rawEndpoint.endpointId, 256),
    };
    if (rawEndpoint.scope !== undefined) endpoint.scope = parseScope(rawEndpoint.scope);
    if (rawEndpoint.cookie !== undefined) endpoint.cookie = jsonObject(rawEndpoint.cookie);
    return endpoint;
}

function parseScope(input: unknown): AlexaScope {
    const rawScope = record(input);
    if (rawScope.type !== 'BearerToken') throw new AlexaSchemaError();
    return {
        type: 'BearerToken',
        token: string(rawScope.token, 8_192),
    };
}

function positiveIntegerSuffix(value: string, prefix: string): number | null {
    if (!value.startsWith(prefix)) return null;
    const suffix = value.slice(prefix.length);
    if (!/^[1-9]\d*$/.test(suffix)) return null;
    const id = Number(suffix);
    return Number.isSafeInteger(id) ? id : null;
}

function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new AlexaSchemaError();
    return value;
}

function jsonObject(value: unknown): JsonObject {
    return { ...record(value) };
}

function string(value: unknown, maxLength: number): string {
    if (typeof value !== 'string' || !value || value.length > maxLength) {
        throw new AlexaSchemaError();
    }
    return value;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return string(value, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
