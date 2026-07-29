import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestWithAuth, ResponseLike } from './auth.types';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.authService.login(body.email, body.password, request);
    response.setHeader(
      'Set-Cookie',
      this.authService.sessionCookies(
        result.sessionToken,
        result.csrfToken,
        result.expiresIn,
        request,
      ),
    );
    return {
      user: result.user,
      csrfToken: result.csrfToken,
      expiresIn: result.expiresIn,
    };
  }

  @Get(['auth/session', 'auth/me'])
  me(@Req() request: RequestWithAuth) {
    return { user: this.authService.sessionFromRequest(request).user };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  logout(
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    this.authService.logout(request);
    response.setHeader('Set-Cookie', this.authService.clearSessionCookies(request));
    return { loggedOut: true };
  }

  @Get('oauth/authorize')
  authorizationRequest(
    @Query() query: Record<string, unknown>,
    @Req() request: RequestWithAuth,
  ) {
    return this.authService.getAuthorizationRequest(query, request);
  }

  @Post('oauth/authorize')
  authorize(
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const location = this.authService.authorize(body, request);
    response.statusCode = 302;
    response.setHeader('Location', location);
    return;
  }

  @Post('oauth/token')
  @HttpCode(HttpStatus.OK)
  token(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: RequestWithAuth,
  ) {
    return this.authService.exchangeToken(body, authorization, request);
  }

  @Post('oauth/introspect')
  @HttpCode(HttpStatus.OK)
  introspect(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.authService.introspect(body.token, body, authorization);
  }

  @Post('oauth/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    this.authService.revoke(body.token, body, authorization);
    return {};
  }

  @Get([
    '.well-known/oauth-protected-resource',
    '.well-known/oauth-protected-resource/mcp',
  ])
  protectedResourceMetadata() {
    return this.authService.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-authorization-server')
  authorizationServerMetadata() {
    return this.authService.authorizationServerMetadata();
  }
}
