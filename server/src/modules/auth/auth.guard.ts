import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTH_AUDIENCE_METADATA,
  AUTH_SCOPES_METADATA,
} from './auth.decorators';
import { AuthService } from './auth.service';
import { RequestWithAuth } from './auth.types';

@Injectable()
export class OAuthBearerGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(AUTH_SCOPES_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const audience = this.reflector.getAllAndOverride<string>(
      AUTH_AUDIENCE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    try {
      const authorization = this.header(request, 'authorization');
      const match = authorization?.match(/^Bearer\s+(.+)$/i);
      if (!match?.[1]) throw new UnauthorizedException('Bearer token required');

      request.auth = this.authService.validateAccessToken(match[1], {
        requiredScopes,
        audience,
      });
      return true;
    } catch (error) {
      if (audience === 'mini-has-mcp') {
        const response = context.switchToHttp().getResponse<{
          setHeader(name: string, value: string): void;
        }>();
        response.setHeader(
          'WWW-Authenticate',
          this.authService.mcpAuthenticateHeader(requiredScopes),
        );
      }
      throw error;
    }
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers?.[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
