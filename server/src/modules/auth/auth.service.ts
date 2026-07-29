import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  hashPassword,
  hashToken,
  isValidPkceVerifier,
  pkceChallenge,
  randomOpaqueToken,
  safeStringEqual,
  verifyPassword,
} from './auth.crypto';
import {
  AccessTokenValidationOptions,
  AuthPrincipal,
  AuthUser,
  OAuthClient,
  RequestWithAuth,
} from './auth.types';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  disabled: number;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  role: string;
  disabled: number;
}

interface AuthorizationCodeRow {
  id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  audience: string;
  code_challenge: string | null;
  expires_at: string;
  used_at: string | null;
  disabled: number;
}

interface AccessTokenRow {
  client_id: string;
  user_id: string;
  scope: string;
  audience: string;
  expires_at: string;
  revoked_at: string | null;
  disabled: number;
}

interface RefreshTokenRow extends AccessTokenRow {
  id: string;
  family_id: string;
}

interface LoginAttemptRow {
  attempts: number;
  window_started_at: string;
  blocked_until: string | null;
}

interface AuthorizationRequest {
  client: OAuthClient;
  redirectUri: string;
  scopes: string[];
  state?: string;
  codeChallenge?: string;
  resource?: string;
}

interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const DEFAULT_SCOPES = [
  'devices:read',
  'devices:control',
  'scenes:read',
  'scenes:run',
  'mcp:connect',
];

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly oauthClients = new Map<string, OAuthClient>();
  private readonly sessionSeconds = this.numberEnv('MINI_HAS_SESSION_TTL_SECONDS', 43_200, 300, 2_592_000);
  private readonly accessTokenSeconds = this.numberEnv('MINI_HAS_ACCESS_TOKEN_TTL_SECONDS', 3_600, 300, 86_400);
  private readonly refreshTokenSeconds = this.numberEnv('MINI_HAS_REFRESH_TOKEN_TTL_SECONDS', 2_592_000, 3_600, 31_536_000);
  private readonly authCodeSeconds = this.numberEnv('MINI_HAS_AUTH_CODE_TTL_SECONDS', 300, 60, 600);
  private readonly cookieName = process.env.MINI_HAS_SESSION_COOKIE || 'mini_has_session';
  private readonly csrfCookieName = process.env.MINI_HAS_CSRF_COOKIE || 'mini_has_xsrf';

  constructor(private readonly storage: StorageService) {}

  async onModuleInit(): Promise<void> {
    this.ensureSchema();
    this.loadOAuthClients();
    await this.bootstrapAdmin();
    this.cleanupExpired();
  }

  async login(
    emailInput: unknown,
    passwordInput: unknown,
    request: RequestWithAuth,
  ): Promise<{
    user: AuthUser;
    sessionToken: string;
    csrfToken: string;
    expiresIn: number;
  }> {
    const email = this.normalizeEmail(this.requiredString(emailInput, 'email', 254));
    const password = this.requiredString(passwordInput, 'password', 1024);
    const rateLimitKeys = this.rateLimitKeys(email, request);
    this.assertLoginAllowed(rateLimitKeys);

    const user = this.storage.get<UserRow>(
      `SELECT id, email, password_hash, role, disabled
       FROM auth_users WHERE email = ? COLLATE NOCASE`,
      [email],
    );
    const valid = user ? await verifyPassword(password, user.password_hash) : await this.fakePasswordCheck(password);
    if (!user || !valid || user.disabled === 1) {
      this.recordLoginFailure(rateLimitKeys);
      this.audit('login_failed', undefined, undefined, request);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.clearLoginFailures(rateLimitKeys);
    const sessionToken = randomOpaqueToken();
    const csrfToken = randomOpaqueToken();
    const now = this.storage.utcNow();
    const expiresAt = this.afterSeconds(this.sessionSeconds);
    this.storage.transaction(() => {
      this.storage.run(
        `INSERT INTO auth_sessions
          (id, token_hash, user_id, csrf_hash, expires_at, revoked_at, created_at, last_seen_at, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          randomUUID(),
          hashToken(sessionToken),
          user.id,
          hashToken(csrfToken),
          expiresAt,
          now,
          now,
          this.requestIpHash(request),
          this.header(request, 'user-agent')?.slice(0, 512) ?? null,
        ],
      );
      this.storage.run(
        'UPDATE auth_users SET last_login_at = ?, updated_at = ? WHERE id = ?',
        [now, now, user.id],
      );
    });
    this.audit('login_succeeded', user.id, undefined, request);

    return {
      user: this.publicUser(user),
      sessionToken,
      csrfToken,
      expiresIn: this.sessionSeconds,
    };
  }

  sessionFromRequest(request: RequestWithAuth): {
    user: AuthUser;
    sessionToken: string;
    csrfHash: string;
  } {
    const sessionToken = this.cookie(request, this.cookieName);
    if (!sessionToken) throw new UnauthorizedException('Authentication required');

    const session = this.storage.get<SessionRow>(
      `SELECT s.token_hash, s.user_id, s.csrf_hash, s.expires_at, s.revoked_at,
              u.email, u.role, u.disabled
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
      [hashToken(sessionToken)],
    );
    if (
      !session ||
      session.revoked_at ||
      session.disabled === 1 ||
      this.isExpired(session.expires_at)
    ) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    this.storage.run(
      'UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?',
      [this.storage.utcNow(), session.token_hash],
    );
    return {
      user: {
        id: session.user_id,
        email: session.email,
        role: session.role,
      },
      sessionToken,
      csrfHash: session.csrf_hash,
    };
  }

  assertCsrf(request: RequestWithAuth, csrfHash: string): void {
    const headerToken = this.header(request, 'x-csrf-token');
    const cookieToken = this.cookie(request, this.csrfCookieName);
    if (
      !headerToken ||
      !cookieToken ||
      !safeStringEqual(headerToken, cookieToken) ||
      !safeStringEqual(hashToken(headerToken), csrfHash)
    ) {
      throw new ForbiddenException('Invalid CSRF token');
    }
  }

  logout(request: RequestWithAuth): void {
    const session = this.sessionFromRequest(request);
    this.assertCsrf(request, session.csrfHash);
    this.storage.run(
      'UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
      [this.storage.utcNow(), hashToken(session.sessionToken)],
    );
    this.audit('logout', session.user.id, undefined, request);
  }

  getAuthorizationRequest(
    input: Record<string, unknown>,
    request: RequestWithAuth,
  ): {
    client: { clientId: string; name: string };
    redirectUri: string;
    scopes: string[];
    state?: string;
    user: AuthUser;
  } {
    const session = this.sessionFromRequest(request);
    const authorization = this.validateAuthorizationRequest(input);
    return {
      client: {
        clientId: authorization.client.clientId,
        name: authorization.client.name,
      },
      redirectUri: authorization.redirectUri,
      scopes: authorization.scopes,
      state: authorization.state,
      user: session.user,
    };
  }

  authorize(
    input: Record<string, unknown>,
    request: RequestWithAuth,
  ): string {
    const session = this.sessionFromRequest(request);
    this.assertCsrf(request, session.csrfHash);
    const authorization = this.validateAuthorizationRequest(input);
    if (input.approved !== true && input.approved !== 'true') {
      return this.redirectWithParams(authorization.redirectUri, {
        error: 'access_denied',
        state: authorization.state,
      });
    }

    const code = randomOpaqueToken();
    const now = this.storage.utcNow();
    this.storage.run(
      `INSERT INTO oauth_authorization_codes
        (id, code_hash, client_id, user_id, redirect_uri, scope, audience,
         code_challenge, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        randomUUID(),
        hashToken(code),
        authorization.client.clientId,
        session.user.id,
        authorization.redirectUri,
        authorization.scopes.join(' '),
        authorization.client.audience,
        authorization.codeChallenge ?? null,
        this.afterSeconds(this.authCodeSeconds),
        now,
      ],
    );
    this.audit('oauth_authorized', session.user.id, authorization.client.clientId, request);
    return this.redirectWithParams(authorization.redirectUri, {
      code,
      state: authorization.state,
    });
  }

  exchangeToken(
    input: Record<string, unknown>,
    authorizationHeader?: string,
    request?: RequestWithAuth,
  ): TokenPair {
    const grantType = this.requiredString(input.grant_type, 'grant_type', 64);
    const client = this.authenticateClient(input, authorizationHeader);
    this.validateResource(input.resource, client);

    if (grantType === 'authorization_code') {
      const pair = this.exchangeAuthorizationCode(input, client);
      this.audit('oauth_code_exchanged', undefined, client.clientId, request);
      return pair;
    }
    if (grantType === 'refresh_token') {
      const pair = this.exchangeRefreshToken(input, client);
      this.audit('oauth_token_refreshed', undefined, client.clientId, request);
      return pair;
    }
    throw new BadRequestException({
      error: 'unsupported_grant_type',
      error_description: 'Unsupported grant_type',
    });
  }

  validateAccessToken(
    token: string,
    options: AccessTokenValidationOptions = {},
  ): AuthPrincipal {
    const row = this.storage.get<AccessTokenRow>(
      `SELECT t.client_id, t.user_id, t.scope, t.audience, t.expires_at,
              t.revoked_at, u.disabled
       FROM oauth_access_tokens t
       JOIN auth_users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
      [hashToken(token)],
    );
    if (!row || row.revoked_at || row.disabled === 1 || this.isExpired(row.expires_at)) {
      throw new UnauthorizedException('Access token expired or invalid');
    }

    const scopes = this.parseScopes(row.scope);
    if (options.audience && row.audience !== options.audience) {
      throw new UnauthorizedException('Invalid token audience');
    }
    const missing = (options.requiredScopes ?? []).filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required scope: ${missing.join(', ')}`);
    }

    return {
      userId: row.user_id,
      clientId: row.client_id,
      scopes,
      audience: row.audience,
      tokenType: 'oauth',
    };
  }

  introspect(
    tokenInput: unknown,
    input: Record<string, unknown>,
    authorizationHeader?: string,
  ): Record<string, unknown> {
    const client = this.authenticateClient(input, authorizationHeader, true);
    const token = this.requiredString(tokenInput, 'token', 2048);
    const row = this.storage.get<AccessTokenRow>(
      `SELECT t.client_id, t.user_id, t.scope, t.audience, t.expires_at,
              t.revoked_at, u.disabled
       FROM oauth_access_tokens t
       JOIN auth_users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
      [hashToken(token)],
    );
    if (
      !row ||
      row.client_id !== client.clientId ||
      row.revoked_at ||
      row.disabled === 1 ||
      this.isExpired(row.expires_at)
    ) {
      return { active: false };
    }
    return {
      active: true,
      client_id: row.client_id,
      sub: row.user_id,
      scope: row.scope,
      aud: row.audience,
      exp: Math.floor(new Date(row.expires_at).getTime() / 1000),
      token_type: 'Bearer',
    };
  }

  revoke(
    tokenInput: unknown,
    input: Record<string, unknown>,
    authorizationHeader?: string,
  ): void {
    const client = this.authenticateClient(input, authorizationHeader);
    const token = this.requiredString(tokenInput, 'token', 2048);
    const tokenHash = hashToken(token);
    const now = this.storage.utcNow();
    this.storage.run(
      `UPDATE oauth_access_tokens SET revoked_at = ?
       WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
      [now, tokenHash, client.clientId],
    );
    this.storage.run(
      `UPDATE oauth_refresh_tokens SET revoked_at = ?
       WHERE token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
      [now, tokenHash, client.clientId],
    );
  }

  sessionCookies(
    sessionToken: string,
    csrfToken: string,
    maxAge: number,
    request?: RequestWithAuth,
  ): string[] {
    const secure = this.secureCookies(request) ? '; Secure' : '';
    return [
      `${this.cookieName}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
      `${this.csrfCookieName}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`,
    ];
  }

  clearSessionCookies(request?: RequestWithAuth): string[] {
    const secure = this.secureCookies(request) ? '; Secure' : '';
    return [
      `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      `${this.csrfCookieName}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
    ];
  }

  protectedResourceMetadata(): Record<string, unknown> {
    const baseUrl = this.publicBaseUrl();
    return {
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: DEFAULT_SCOPES,
      bearer_methods_supported: ['header'],
    };
  }

  authorizationServerMetadata(): Record<string, unknown> {
    const baseUrl = this.publicBaseUrl();
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      introspection_endpoint: `${baseUrl}/oauth/introspect`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      resource_indicators_supported: true,
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post',
        'none',
      ],
      scopes_supported: DEFAULT_SCOPES,
    };
  }

  mcpAuthenticateHeader(requiredScopes: string[]): string {
    const resourceMetadata = `${this.publicBaseUrl()}/.well-known/oauth-protected-resource/mcp`;
    const scope = [...new Set(requiredScopes)].join(' ');
    return `Bearer resource_metadata="${resourceMetadata}"${scope ? `, scope="${scope}"` : ''}`;
  }

  private exchangeAuthorizationCode(
    input: Record<string, unknown>,
    client: OAuthClient,
  ): TokenPair {
    const code = this.requiredString(input.code, 'code', 2048);
    const redirectUri = this.requiredString(input.redirect_uri, 'redirect_uri', 2048);
    const row = this.storage.get<AuthorizationCodeRow>(
      `SELECT c.id, c.client_id, c.user_id, c.redirect_uri, c.scope, c.audience,
              c.code_challenge, c.expires_at, c.used_at, u.disabled
       FROM oauth_authorization_codes c
       JOIN auth_users u ON u.id = c.user_id
       WHERE c.code_hash = ?`,
      [hashToken(code)],
    );
    if (
      !row ||
      row.client_id !== client.clientId ||
      row.redirect_uri !== redirectUri ||
      row.used_at ||
      row.disabled === 1 ||
      this.isExpired(row.expires_at)
    ) {
      throw new BadRequestException({
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      });
    }

    if (row.code_challenge) {
      const verifier = this.requiredString(input.code_verifier, 'code_verifier', 256);
      if (
        !isValidPkceVerifier(verifier) ||
        !safeStringEqual(pkceChallenge(verifier), row.code_challenge)
      ) {
        throw new BadRequestException({
          error: 'invalid_grant',
          error_description: 'PKCE verification failed',
        });
      }
    }

    const updated = this.storage.run(
      `UPDATE oauth_authorization_codes SET used_at = ?
       WHERE id = ? AND used_at IS NULL`,
      [this.storage.utcNow(), row.id],
    );
    if (updated.changes !== 1) {
      throw new BadRequestException({
        error: 'invalid_grant',
        error_description: 'Authorization code was already used',
      });
    }
    return this.issueTokenPair(client, row.user_id, this.parseScopes(row.scope), row.audience);
  }

  private exchangeRefreshToken(
    input: Record<string, unknown>,
    client: OAuthClient,
  ): TokenPair {
    const refreshToken = this.requiredString(input.refresh_token, 'refresh_token', 2048);
    const tokenHash = hashToken(refreshToken);
    const row = this.storage.get<RefreshTokenRow>(
      `SELECT t.id, t.family_id, t.client_id, t.user_id, t.scope, t.audience,
              t.expires_at, t.revoked_at, u.disabled
       FROM oauth_refresh_tokens t
       JOIN auth_users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
      [tokenHash],
    );
    if (!row || row.client_id !== client.clientId || row.disabled === 1) {
      throw this.invalidRefreshGrant();
    }
    if (row.revoked_at) {
      this.revokeTokenFamily(row.family_id, row.client_id, row.user_id);
      throw this.invalidRefreshGrant();
    }
    if (this.isExpired(row.expires_at)) {
      this.storage.run(
        'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE id = ?',
        [this.storage.utcNow(), row.id],
      );
      throw this.invalidRefreshGrant();
    }

    const originalScopes = this.parseScopes(row.scope);
    const requestedScopes = input.scope
      ? this.parseAndValidateScopes(
          this.requiredString(input.scope, 'scope', 2048),
          client.allowedScopes,
        )
      : originalScopes;
    if (requestedScopes.some((scope) => !originalScopes.includes(scope))) {
      throw new BadRequestException({
        error: 'invalid_scope',
        error_description: 'Refresh request cannot expand scopes',
      });
    }

    return this.storage.transaction(() => {
      const revoked = this.storage.run(
        `UPDATE oauth_refresh_tokens SET revoked_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
        [this.storage.utcNow(), row.id],
      );
      if (revoked.changes !== 1) {
        this.revokeTokenFamily(row.family_id, row.client_id, row.user_id);
        throw this.invalidRefreshGrant();
      }
      return this.issueTokenPair(
        client,
        row.user_id,
        requestedScopes,
        row.audience,
        row.family_id,
        row.id,
      );
    });
  }

  private issueTokenPair(
    client: OAuthClient,
    userId: string,
    scopes: string[],
    audience: string,
    familyId: string = randomUUID(),
    replacedTokenId?: string,
  ): TokenPair {
    const accessToken = randomOpaqueToken();
    const refreshToken = randomOpaqueToken(48);
    const accessId = randomUUID();
    const refreshId = randomUUID();
    const now = this.storage.utcNow();
    this.storage.run(
      `INSERT INTO oauth_access_tokens
        (id, token_hash, client_id, user_id, scope, audience, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        accessId,
        hashToken(accessToken),
        client.clientId,
        userId,
        scopes.join(' '),
        audience,
        this.afterSeconds(this.accessTokenSeconds),
        now,
      ],
    );
    this.storage.run(
      `INSERT INTO oauth_refresh_tokens
        (id, token_hash, family_id, client_id, user_id, scope, audience,
         expires_at, revoked_at, replaced_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        refreshId,
        hashToken(refreshToken),
        familyId,
        client.clientId,
        userId,
        scopes.join(' '),
        audience,
        this.afterSeconds(this.refreshTokenSeconds),
        now,
      ],
    );
    if (replacedTokenId) {
      this.storage.run(
        'UPDATE oauth_refresh_tokens SET replaced_by_id = ? WHERE id = ?',
        [refreshId, replacedTokenId],
      );
    }

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  private validateAuthorizationRequest(
    input: Record<string, unknown>,
  ): AuthorizationRequest {
    const responseType = this.requiredString(input.response_type, 'response_type', 64);
    if (responseType !== 'code') {
      throw new BadRequestException({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      });
    }

    const clientId = this.requiredString(input.client_id, 'client_id', 256);
    const client = this.oauthClients.get(clientId);
    if (!client) throw new BadRequestException('Unknown OAuth client');
    const redirectUri = this.requiredString(input.redirect_uri, 'redirect_uri', 2048);
    if (!client.redirectUris.includes(redirectUri)) {
      throw new BadRequestException('Invalid redirect_uri');
    }

    const scopeValue =
      typeof input.scope === 'string' && input.scope.trim()
        ? input.scope
        : client.allowedScopes.join(' ');
    const scopes = this.parseAndValidateScopes(scopeValue, client.allowedScopes);
    const state =
      typeof input.state === 'string' && input.state.length <= 2048
        ? input.state
        : undefined;
    const challenge =
      typeof input.code_challenge === 'string' ? input.code_challenge : undefined;
    const method =
      typeof input.code_challenge_method === 'string'
        ? input.code_challenge_method
        : undefined;

    if (!client.clientSecret && (!challenge || method !== 'S256')) {
      throw new BadRequestException('Public OAuth clients must use PKCE S256');
    }
    if (challenge && (method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) {
      throw new BadRequestException('Invalid PKCE challenge');
    }
    const resource = this.validateResource(input.resource, client);

    return {
      client,
      redirectUri,
      scopes,
      state,
      codeChallenge: challenge,
      resource,
    };
  }

  private validateResource(
    input: unknown,
    client: OAuthClient,
  ): string | undefined {
    const expected =
      client.audience === 'mini-has-mcp'
        ? `${this.publicBaseUrl()}/mcp`
        : undefined;
    if (!expected) {
      if (input === undefined) return undefined;
      throw new BadRequestException({
        error: 'invalid_target',
        error_description: 'This OAuth client does not accept a resource parameter',
      });
    }
    if (typeof input !== 'string' || input !== expected) {
      throw new BadRequestException({
        error: 'invalid_target',
        error_description: 'The requested resource is invalid',
      });
    }
    return expected;
  }

  private authenticateClient(
    input: Record<string, unknown>,
    authorizationHeader?: string,
    requireConfidential = false,
  ): OAuthClient {
    let clientId =
      typeof input.client_id === 'string' ? input.client_id : undefined;
    let clientSecret =
      typeof input.client_secret === 'string' ? input.client_secret : undefined;

    if (authorizationHeader?.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authorizationHeader.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 1) throw new Error('invalid');
        clientId = decodeURIComponent(decoded.slice(0, separator));
        clientSecret = decodeURIComponent(decoded.slice(separator + 1));
      } catch {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description: 'Invalid client authentication',
        });
      }
    }

    if (!clientId) {
      throw new UnauthorizedException({
        error: 'invalid_client',
        error_description: 'client_id is required',
      });
    }
    const client = this.oauthClients.get(clientId);
    if (!client) {
      throw new UnauthorizedException({
        error: 'invalid_client',
        error_description: 'Invalid client authentication',
      });
    }
    if (client.clientSecret) {
      if (!clientSecret || !safeStringEqual(client.clientSecret, clientSecret)) {
        throw new UnauthorizedException({
          error: 'invalid_client',
          error_description: 'Invalid client authentication',
        });
      }
    } else if (requireConfidential) {
      throw new UnauthorizedException({
        error: 'invalid_client',
        error_description: 'Confidential client required',
      });
    }
    return client;
  }

  private ensureSchema(): void {
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        disabled INTEGER NOT NULL DEFAULT 0,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        csrf_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip_hash TEXT,
        user_agent TEXT,
        FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS auth_login_attempts (
        rate_key TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        window_started_at TEXT NOT NULL,
        blocked_until TEXT
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS auth_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        user_id TEXT,
        client_id TEXT,
        ip_hash TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL,
        audience TEXT NOT NULL,
        code_challenge TEXT,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        audience TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      )
    `);
    this.storage.run(`
      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        family_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        audience TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        replaced_by_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE,
        FOREIGN KEY(replaced_by_id) REFERENCES oauth_refresh_tokens(id)
      )
    `);
    this.storage.run(
      'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at)',
    );
    this.storage.run(
      'CREATE INDEX IF NOT EXISTS idx_oauth_access_expiry ON oauth_access_tokens(expires_at)',
    );
    this.storage.run(
      'CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens(family_id)',
    );
  }

  private loadOAuthClients(): void {
    const raw = process.env.MINI_HAS_OAUTH_CLIENTS_JSON;
    if (!raw) {
      this.logger.warn('No OAuth clients configured (MINI_HAS_OAUTH_CLIENTS_JSON)');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException('MINI_HAS_OAUTH_CLIENTS_JSON is invalid JSON');
    }
    if (!Array.isArray(parsed)) {
      throw new ServiceUnavailableException('MINI_HAS_OAUTH_CLIENTS_JSON must be an array');
    }

    for (const value of parsed) {
      if (!this.isRecord(value)) {
        throw new ServiceUnavailableException('Invalid OAuth client configuration');
      }
      const clientId = this.configString(value.clientId, 'clientId');
      const name =
        typeof value.name === 'string' && value.name.trim()
          ? value.name.trim()
          : clientId;
      const redirectUris = this.configStringArray(value.redirectUris, 'redirectUris');
      const allowedScopes = value.allowedScopes
        ? this.configStringArray(value.allowedScopes, 'allowedScopes')
        : DEFAULT_SCOPES;
      const audience =
        typeof value.audience === 'string' && value.audience.trim()
          ? value.audience.trim()
          : 'mini-has';
      const clientSecret =
        typeof value.clientSecret === 'string' && value.clientSecret
          ? value.clientSecret
          : undefined;

      if (this.oauthClients.has(clientId)) {
        throw new ServiceUnavailableException(`Duplicate OAuth client: ${clientId}`);
      }
      if (redirectUris.some((uri) => !this.isAllowedRedirectUri(uri))) {
        throw new ServiceUnavailableException(`Unsafe redirect URI for OAuth client: ${clientId}`);
      }
      this.oauthClients.set(clientId, {
        clientId,
        clientSecret,
        name,
        redirectUris,
        allowedScopes: [...new Set(allowedScopes)].sort(),
        audience,
      });
    }
  }

  private async bootstrapAdmin(): Promise<void> {
    const count = this.storage.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM auth_users',
    )?.count ?? 0;
    if (count > 0) return;

    const emailValue = process.env.MINI_HAS_ADMIN_EMAIL;
    const passwordValue = process.env.MINI_HAS_ADMIN_PASSWORD;
    if (!emailValue || !passwordValue) {
      this.logger.warn(
        'No auth user exists. Set MINI_HAS_ADMIN_EMAIL and MINI_HAS_ADMIN_PASSWORD to bootstrap one.',
      );
      return;
    }
    const email = this.normalizeEmail(emailValue);
    this.assertPasswordPolicy(passwordValue);
    const now = this.storage.utcNow();
    this.storage.run(
      `INSERT INTO auth_users
        (id, email, password_hash, role, disabled, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', 0, NULL, ?, ?)`,
      [randomUUID(), email, await hashPassword(passwordValue), now, now],
    );
    this.logger.log(`Bootstrapped local admin account: ${email}`);
  }

  private assertPasswordPolicy(password: string): void {
    if (password.length < 12 || password.length > 1024) {
      throw new ServiceUnavailableException(
        'MINI_HAS_ADMIN_PASSWORD must contain between 12 and 1024 characters',
      );
    }
  }

  private async fakePasswordCheck(password: string): Promise<boolean> {
    return verifyPassword(
      password,
      'scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$bvhsDi_IQ3xkdwsjpEhHyMIGYmCO6yPrHMmaM1bJA8jDCrLzG9f2-EoZg5-4HN6jgpZnwr7WHPSIGRHgttzd9w',
    );
  }

  private rateLimitKeys(email: string, request: RequestWithAuth): string[] {
    return [
      `email:${hashToken(email)}`,
      `ip:${this.requestIpHash(request) ?? 'unknown'}`,
    ];
  }

  private assertLoginAllowed(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const row = this.storage.get<LoginAttemptRow>(
        `SELECT attempts, window_started_at, blocked_until
         FROM auth_login_attempts WHERE rate_key = ?`,
        [key],
      );
      if (row?.blocked_until && new Date(row.blocked_until).getTime() > now) {
        throw new UnauthorizedException('Invalid email or password');
      }
    }
  }

  private recordLoginFailure(keys: string[]): void {
    const now = this.storage.utcNow();
    const blockUntil = this.afterSeconds(900);
    for (const key of keys) {
      const row = this.storage.get<LoginAttemptRow>(
        `SELECT attempts, window_started_at, blocked_until
         FROM auth_login_attempts WHERE rate_key = ?`,
        [key],
      );
      const withinWindow =
        row && Date.now() - new Date(row.window_started_at).getTime() < 900_000;
      const attempts = withinWindow ? row.attempts + 1 : 1;
      this.storage.run(
        `INSERT INTO auth_login_attempts
          (rate_key, attempts, window_started_at, blocked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(rate_key) DO UPDATE SET
           attempts = excluded.attempts,
           window_started_at = excluded.window_started_at,
           blocked_until = excluded.blocked_until`,
        [key, attempts, withinWindow ? row.window_started_at : now, attempts >= 5 ? blockUntil : null],
      );
    }
  }

  private clearLoginFailures(keys: string[]): void {
    for (const key of keys) {
      this.storage.run('DELETE FROM auth_login_attempts WHERE rate_key = ?', [key]);
    }
  }

  private revokeTokenFamily(familyId: string, clientId: string, userId: string): void {
    const now = this.storage.utcNow();
    this.storage.run(
      `UPDATE oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
       WHERE family_id = ?`,
      [now, familyId],
    );
    this.storage.run(
      `UPDATE oauth_access_tokens SET revoked_at = COALESCE(revoked_at, ?)
       WHERE client_id = ? AND user_id = ?`,
      [now, clientId, userId],
    );
  }

  private invalidRefreshGrant(): BadRequestException {
    return new BadRequestException({
      error: 'invalid_grant',
      error_description: 'Refresh token is invalid or expired',
    });
  }

  private audit(
    event: string,
    userId?: string,
    clientId?: string,
    request?: RequestWithAuth,
  ): void {
    this.storage.run(
      `INSERT INTO auth_audit_logs (event, user_id, client_id, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event,
        userId ?? null,
        clientId ?? null,
        request ? this.requestIpHash(request) : null,
        this.storage.utcNow(),
      ],
    );
  }

  private cleanupExpired(): void {
    const now = this.storage.utcNow();
    this.storage.run(
      'DELETE FROM oauth_authorization_codes WHERE expires_at < ? OR used_at IS NOT NULL',
      [now],
    );
    this.storage.run(
      'DELETE FROM auth_login_attempts WHERE window_started_at < ?',
      [new Date(Date.now() - 86_400_000).toISOString()],
    );
  }

  private requestIpHash(request: RequestWithAuth): string | null {
    let ip = request.socket?.remoteAddress;
    if (process.env.MINI_HAS_TRUST_PROXY === 'true') {
      const cloudflareIp = this.header(request, 'cf-connecting-ip');
      const forwarded = this.header(request, 'x-forwarded-for')?.split(',')[0]?.trim();
      ip = cloudflareIp || forwarded || ip;
    }
    return ip ? hashToken(ip) : null;
  }

  private parseAndValidateScopes(scope: string, allowedScopes: string[]): string[] {
    const scopes = this.parseScopes(scope);
    if (scopes.length === 0 || scopes.some((value) => !allowedScopes.includes(value))) {
      throw new BadRequestException({
        error: 'invalid_scope',
        error_description: 'Requested scope is not allowed',
      });
    }
    return scopes;
  }

  private parseScopes(scope: string): string[] {
    return [...new Set(scope.split(/\s+/).map((value) => value.trim()).filter(Boolean))].sort();
  }

  private redirectWithParams(
    redirectUri: string,
    params: Record<string, string | undefined>,
  ): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private cookie(request: RequestWithAuth, name: string): string | undefined {
    const header = this.header(request, 'cookie');
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== name) continue;
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private publicUser(user: UserRow): AuthUser {
    return { id: user.id, email: user.email, role: user.role };
  }

  private normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new BadRequestException('Invalid email');
    }
    return email;
  }

  private requiredString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== 'string' || !value || value.length > maxLength) {
      throw new BadRequestException(`${field} is required`);
    }
    return value;
  }

  private numberEnv(name: string, fallback: number, minimum: number, maximum: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value >= minimum && value <= maximum
      ? value
      : fallback;
  }

  private afterSeconds(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  private isExpired(value: string): boolean {
    return new Date(value).getTime() <= Date.now();
  }

  private secureCookies(request?: RequestWithAuth): boolean {
    const configured = process.env.MINI_HAS_COOKIE_SECURE;
    if (configured !== undefined) return configured === 'true';
    const forwardedProtocol =
      process.env.MINI_HAS_TRUST_PROXY === 'true'
        ? this.header(request || {}, 'x-forwarded-proto')?.split(',')[0]?.trim()
        : undefined;
    return forwardedProtocol === 'https'
      || request?.secure === true
      || request?.protocol === 'https'
      || request?.socket?.encrypted === true;
  }

  private publicBaseUrl(): string {
    const value = String(process.env.MINI_HAS_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error();
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      throw new ServiceUnavailableException(
        'MINI_HAS_PUBLIC_URL must be an HTTPS URL',
      );
    }
  }

  private isAllowedRedirectUri(uri: string): boolean {
    try {
      const parsed = new URL(uri);
      return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  private configString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ServiceUnavailableException(`OAuth client ${field} is required`);
    }
    return value.trim();
  }

  private configStringArray(value: unknown, field: string): string[] {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((item) => typeof item !== 'string' || !item.trim())
    ) {
      throw new ServiceUnavailableException(`OAuth client ${field} must be a non-empty string array`);
    }
    return value.map((item) => String(item).trim());
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
