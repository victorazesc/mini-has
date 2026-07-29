import { BadRequestException, ForbiddenException, Injectable, NotAcceptableException, UnauthorizedException } from '@nestjs/common';
import {
    McpAccessContext,
    MCP_PROTOCOL_VERSION,
    MCP_SCOPES,
    MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from './mcp.types';

interface McpAuthPayload {
    userId?: string | number;
    clientId?: string;
    scopes?: unknown;
}

export interface McpHttpRequest {
    auth?: McpAuthPayload;
    headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class McpAccessService {
    resolve(request: McpHttpRequest): McpAccessContext {
        const auth = request.auth;
        if (!auth) throw new UnauthorizedException('MCP authentication required');

        const scopes = new Set(normalizeScopes(auth.scopes));
        if (!scopes.has(MCP_SCOPES.connect)) {
            throw new ForbiddenException(`Missing required scope: ${MCP_SCOPES.connect}`);
        }

        return {
            subject: String(auth.userId || 'unknown'),
            clientId: auth.clientId ? String(auth.clientId) : undefined,
            scopes,
        };
    }

    assertTransportHeaders(request: McpHttpRequest): void {
        const accept = header(request, 'accept');
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
            throw new NotAcceptableException('Accept must include application/json and text/event-stream');
        }

        const protocolVersion = header(request, 'mcp-protocol-version');
        if (protocolVersion && !MCP_SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
            throw new BadRequestException(`Unsupported MCP protocol version: ${protocolVersion}`);
        }

        const origin = header(request, 'origin');
        if (!origin) return;

        const allowedOrigins = String(process.env.MCP_ALLOWED_ORIGINS || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);

        if (!allowedOrigins.includes(origin)) {
            throw new ForbiddenException(
                `Origin not allowed. Configure MCP_ALLOWED_ORIGINS for ${origin}`,
            );
        }
    }

    protocolVersion(request: McpHttpRequest): string {
        return header(request, 'mcp-protocol-version') || MCP_PROTOCOL_VERSION;
    }
}

function normalizeScopes(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    return [];
}

function header(request: McpHttpRequest, name: string): string {
    const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}
