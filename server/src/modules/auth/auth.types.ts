export const AUTH_SCOPES = [
  'devices:read',
  'devices:control',
  'scenes:read',
  'scenes:run',
  'mcp:connect',
] as const;

export type AuthScope = (typeof AUTH_SCOPES)[number] | string;

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthPrincipal {
  userId: string;
  clientId?: string;
  scopes: string[];
  audience: string;
  tokenType: 'oauth' | 'session';
}

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  audience: string;
}

export interface AccessTokenValidationOptions {
  requiredScopes?: string[];
  audience?: string;
}

export interface RequestWithAuth {
  auth?: AuthPrincipal;
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
  secure?: boolean;
  socket?: { remoteAddress?: string; encrypted?: boolean };
}

export interface ResponseLike {
  setHeader(name: string, value: string | string[]): void;
  statusCode?: number;
}
