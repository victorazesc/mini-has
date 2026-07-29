export const MCP_PROTOCOL_VERSION = '2025-11-25';

export const MCP_SUPPORTED_PROTOCOL_VERSIONS = new Set([
    '2025-03-26',
    '2025-06-18',
    MCP_PROTOCOL_VERSION,
]);

export const MCP_SCOPES = {
    connect: 'mcp:connect',
    devicesRead: 'devices:read',
    devicesControl: 'devices:control',
    scenesRead: 'scenes:read',
    scenesRun: 'scenes:run',
} as const;

export type McpScope = typeof MCP_SCOPES[keyof typeof MCP_SCOPES];
export type McpRequestId = string | number | null;
export type McpJsonObject = Record<string, unknown>;

export interface McpAccessContext {
    subject: string;
    clientId?: string;
    scopes: ReadonlySet<string>;
}

export interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    id?: McpRequestId;
    method: string;
    params?: McpJsonObject;
}

export interface McpJsonRpcResponse {
    jsonrpc: '2.0';
    id: McpRequestId;
    result?: McpJsonObject;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export interface McpToolDefinition {
    name: string;
    title: string;
    description: string;
    inputSchema: McpJsonObject;
    outputSchema: McpJsonObject;
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
}

export interface McpToolResult extends McpJsonObject {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent?: McpJsonObject;
    isError?: boolean;
}

export class McpProtocolError extends Error {
    constructor(
        readonly code: number,
        message: string,
        readonly data?: unknown,
    ) {
        super(message);
        this.name = 'McpProtocolError';
    }
}

export const MCP_ERROR = {
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
    unauthorized: -32001,
    resourceNotFound: -32002,
} as const;
