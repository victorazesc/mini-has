import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
    AlexaBearerVerificationRequest,
    AlexaBearerVerifier,
} from './alexa.types';

export const ALEXA_BEARER_VERIFIER = 'ALEXA_BEARER_VERIFIER';

@Injectable()
export class MiniHasOAuthAlexaBearerVerifier implements AlexaBearerVerifier {
    constructor(private readonly authService: AuthService) { }

    verify(token: string, request: AlexaBearerVerificationRequest) {
        return this.authService.validateAccessToken(token, {
            requiredScopes: request.requiredScopes,
            audience: request.audience,
        });
    }
}
