import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceModule } from '../device/device.module';
import { SceneModule } from '../scene/scene.module';
import {
    ALEXA_BEARER_VERIFIER,
    MiniHasOAuthAlexaBearerVerifier,
} from './alexa.auth';
import { AlexaController } from './alexa.controller';
import { AlexaService } from './alexa.service';

@Module({
    imports: [AuthModule, DeviceModule, SceneModule],
    controllers: [AlexaController],
    providers: [
        AlexaService,
        {
            provide: ALEXA_BEARER_VERIFIER,
            useClass: MiniHasOAuthAlexaBearerVerifier,
        },
    ],
    exports: [AlexaService, ALEXA_BEARER_VERIFIER],
})
export class AlexaModule { }
