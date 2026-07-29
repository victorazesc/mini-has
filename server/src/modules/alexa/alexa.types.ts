import { JsonObject } from '../../types';

export interface AlexaScope {
    type: 'BearerToken';
    token: string;
}

export interface AlexaHeader {
    namespace: string;
    name: string;
    messageId: string;
    payloadVersion: string;
    correlationToken?: string;
    instance?: string;
}

export interface AlexaEndpointReference {
    endpointId: string;
    scope?: AlexaScope;
    cookie?: JsonObject;
}

export interface AlexaDirective {
    header: AlexaHeader;
    endpoint?: AlexaEndpointReference;
    payload: JsonObject;
}

export interface AlexaRequest {
    directive: AlexaDirective;
}

export type AlexaResponse = JsonObject;

export type AlexaErrorType =
    | 'ENDPOINT_UNREACHABLE'
    | 'INTERNAL_ERROR'
    | 'INVALID_DIRECTIVE'
    | 'NO_SUCH_ENDPOINT'
    | 'NOT_SUPPORTED_IN_CURRENT_MODE'
    | 'TEMPERATURE_VALUE_OUT_OF_RANGE'
    | 'UNSUPPORTED_THERMOSTAT_MODE'
    | 'VALUE_OUT_OF_RANGE';

export interface AlexaEndpointTarget {
    kind: 'device' | 'scene';
    id: number;
}

export interface AlexaBearerVerificationRequest {
    requiredScopes: string[];
    audience: string;
}

export interface AlexaBearerVerifier {
    verify(
        token: string,
        request: AlexaBearerVerificationRequest,
    ): Promise<unknown> | unknown;
}
