import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CameraRecordingService } from '../camera-recording/camera-recording.service';

@Injectable()
export class HealthService {
    constructor(private readonly cameraRecording: CameraRecordingService) { }

    health() {
        const cameras = this.cameraRecording.healthSnapshot();
        const response = {
            status: cameras.required && cameras.status !== 'ok' ? 'degraded' : 'ok',
            cameras,
        };
        if (response.status === 'degraded') {
            throw new ServiceUnavailableException(response);
        }
        return response;
    }
}
