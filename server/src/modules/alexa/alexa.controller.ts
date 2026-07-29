import {
    BadRequestException,
    Body,
    Controller,
    Header,
    Headers,
    HttpCode,
    HttpStatus,
    Inject,
    Post,
    UnauthorizedException,
} from '@nestjs/common';
import {
    directiveAccessToken,
    parseAlexaDirective,
    requiredScopesForDirective,
    safeTokenEqual,
} from './alexa.schemas';
import { AlexaService } from './alexa.service';
import { ALEXA_BEARER_VERIFIER } from './alexa.auth';
import { AlexaBearerVerifier } from './alexa.types';

@Controller('alexa/smarthome')
export class AlexaController {
    constructor(
        private readonly alexa: AlexaService,
        @Inject(ALEXA_BEARER_VERIFIER)
        private readonly bearerVerifier: AlexaBearerVerifier,
    ) { }

    @Post()
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    async handle(
        @Body() body: unknown,
        @Headers('authorization') authorization?: string,
    ) {
        let directive;
        try {
            directive = parseAlexaDirective(body);
        } catch {
            throw new BadRequestException('Invalid Alexa directive');
        }

        const match = authorization?.match(/^Bearer\s+(.+)$/i);
        const bearerToken = match?.[1]?.trim();
        if (!bearerToken) throw new UnauthorizedException('Bearer token required');

        const directiveToken = directiveAccessToken(directive);
        if (!directiveToken || !safeTokenEqual(bearerToken, directiveToken)) {
            throw new UnauthorizedException('Bearer token mismatch');
        }

        await this.bearerVerifier.verify(bearerToken, {
            requiredScopes: requiredScopesForDirective(directive),
            audience: process.env.ALEXA_OAUTH_AUDIENCE || 'mini-has',
        });
        return this.alexa.handleDirective(directive);
    }
}
