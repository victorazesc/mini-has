'use strict';

const { randomUUID } = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 6_500;
const MAX_RESPONSE_BYTES = 1_048_576;

exports.handler = async function handler(event) {
    const directive = event && event.directive;
    const accessToken = directiveAccessToken(directive);
    if (!accessToken) {
        return errorResponse(event, 'INVALID_AUTHORIZATION_CREDENTIAL');
    }

    let endpoint;
    try {
        endpoint = configuredEndpoint();
    } catch {
        return errorResponse(event, 'INTERNAL_ERROR');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs());
    timeout.unref?.();

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'mini-has-alexa-lambda/1.0',
                'X-Mini-Has-Source': 'alexa-lambda',
            },
            body: JSON.stringify(event),
            signal: controller.signal,
        });

        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
            return errorResponse(event, 'INTERNAL_ERROR');
        }
        if (!response.ok) {
            const type = response.status === 401 || response.status === 403
                ? 'INVALID_AUTHORIZATION_CREDENTIAL'
                : 'ENDPOINT_UNREACHABLE';
            return errorResponse(event, type);
        }

        const parsed = JSON.parse(body);
        return isAlexaResponse(parsed)
            ? parsed
            : errorResponse(event, 'INTERNAL_ERROR');
    } catch {
        return errorResponse(event, 'ENDPOINT_UNREACHABLE');
    } finally {
        clearTimeout(timeout);
    }
};

function configuredEndpoint() {
    const raw = String(process.env.MINI_HAS_ALEXA_ENDPOINT || '').trim();
    const endpoint = new URL(raw);
    if (endpoint.protocol !== 'https:') {
        throw new Error('MINI_HAS_ALEXA_ENDPOINT must use HTTPS');
    }
    return endpoint.toString();
}

function timeoutMs() {
    const raw = Number(process.env.MINI_HAS_ALEXA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
    return Math.max(500, Math.min(7_500, Math.trunc(raw)));
}

function directiveAccessToken(directive) {
    if (!directive || typeof directive !== 'object') return null;
    const endpointToken = directive.endpoint
        && directive.endpoint.scope
        && directive.endpoint.scope.token;
    const discoveryToken = directive.payload
        && directive.payload.scope
        && directive.payload.scope.token;
    const token = endpointToken || discoveryToken;
    return typeof token === 'string' && token.length > 0 && token.length <= 8_192
        ? token
        : null;
}

function isAlexaResponse(value) {
    return Boolean(
        value
        && typeof value === 'object'
        && value.event
        && typeof value.event === 'object'
        && value.event.header
        && typeof value.event.header === 'object',
    );
}

function errorResponse(request, type) {
    const directive = request && request.directive;
    const requestHeader = directive && directive.header;
    const requestEndpoint = directive && directive.endpoint;
    const header = {
        namespace: 'Alexa',
        name: 'ErrorResponse',
        messageId: randomUUID(),
        payloadVersion: '3',
    };
    if (requestHeader && typeof requestHeader.correlationToken === 'string') {
        header.correlationToken = requestHeader.correlationToken;
    }

    const event = {
        header,
        payload: {
            type,
            message: safeErrorMessage(type),
        },
    };
    if (requestEndpoint && typeof requestEndpoint.endpointId === 'string') {
        event.endpoint = { endpointId: requestEndpoint.endpointId };
    }
    return { event };
}

function safeErrorMessage(type) {
    if (type === 'INVALID_AUTHORIZATION_CREDENTIAL') {
        return 'The authorization credential is invalid';
    }
    if (type === 'ENDPOINT_UNREACHABLE') {
        return 'The Mini HAS endpoint is unreachable';
    }
    return 'Unable to complete the request';
}

exports._private = {
    configuredEndpoint,
    directiveAccessToken,
    errorResponse,
    timeoutMs,
};
