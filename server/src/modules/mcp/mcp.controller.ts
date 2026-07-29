import { Controller, Get, HttpException, HttpStatus, Post, Req, Res, Body, UseGuards } from '@nestjs/common';
import { RequireAudience, RequireScopes } from '../auth/auth.decorators';
import { OAuthBearerGuard } from '../auth/auth.guard';
import { McpAccessService, McpHttpRequest } from './mcp-access.service';
import { McpService } from './mcp.service';
import { MCP_ERROR, MCP_SCOPES } from './mcp.types';

@Controller('mcp')
@UseGuards(OAuthBearerGuard)
@RequireAudience('mini-has-mcp')
@RequireScopes(
    MCP_SCOPES.connect,
    MCP_SCOPES.devicesRead,
    MCP_SCOPES.devicesControl,
    MCP_SCOPES.scenesRead,
    MCP_SCOPES.scenesRun,
)
export class McpController {
    constructor(
        private readonly mcp: McpService,
        private readonly access: McpAccessService,
    ) { }

    @Get()
    get(@Res() response: any) {
        response.setHeader('Allow', 'POST');
        return response.status(HttpStatus.METHOD_NOT_ALLOWED).send();
    }

    @Post()
    async post(@Body() body: unknown, @Req() request: McpHttpRequest, @Res() response: any) {
        response.setHeader('Cache-Control', 'no-store');

        try {
            this.access.assertTransportHeaders(request);
            const access = this.access.resolve(request);
            const result = await this.mcp.handleMessage(body, access);
            if (!result) return response.status(HttpStatus.ACCEPTED).send();
            return response.status(HttpStatus.OK).type('application/json').send(result);
        } catch (error) {
            const status = error instanceof HttpException
                ? error.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;
            const code = status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN
                ? MCP_ERROR.unauthorized
                : status >= 500
                    ? MCP_ERROR.internal
                    : MCP_ERROR.invalidRequest;
            const message = error instanceof Error ? error.message : 'MCP request failed';

            return response.status(status).type('application/json').send({
                jsonrpc: '2.0',
                id: null,
                error: { code, message },
            });
        }
    }
}
