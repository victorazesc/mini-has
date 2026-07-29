import { SetMetadata } from '@nestjs/common';

export const AUTH_SCOPES_METADATA = 'mini-has:auth-scopes';
export const AUTH_AUDIENCE_METADATA = 'mini-has:auth-audience';

export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(AUTH_SCOPES_METADATA, scopes);

export const RequireAudience = (audience: string) =>
  SetMetadata(AUTH_AUDIENCE_METADATA, audience);
