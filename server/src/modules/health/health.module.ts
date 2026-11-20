import { Module } from '@nestjs/common';
import { CameraRecordingModule } from '../camera-recording/camera-recording.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
    imports: [CameraRecordingModule],
    controllers: [HealthController],
    providers: [HealthService],
})
export class HealthModule { }
