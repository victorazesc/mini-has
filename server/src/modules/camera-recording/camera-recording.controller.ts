import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { CameraRecordingService } from './camera-recording.service';

@Controller('devices/:device_id/recordings')
export class CameraRecordingController {
    constructor(private readonly recordings: CameraRecordingService) { }

    @Get()
    list(@Param('device_id') deviceId: string, @Query('date') date?: string) {
        return this.recordings.listRecordings(Number(deviceId), date);
    }

    @Get(':recording_id/video')
    video(@Param('device_id') deviceId: string, @Param('recording_id') recordingId: string, @Req() request: any, @Res() response: any) {
        if (!this.recordings.streamFile(Number(deviceId), Number(recordingId), 'video', request, response)) {
            throw new NotFoundException('Gravacao nao encontrada.');
        }
    }

    @Get(':recording_id/thumbnail')
    thumbnail(@Param('device_id') deviceId: string, @Param('recording_id') recordingId: string, @Req() request: any, @Res() response: any) {
        if (!this.recordings.streamFile(Number(deviceId), Number(recordingId), 'thumbnail', request, response)) {
            throw new NotFoundException('Miniatura nao encontrada.');
        }
    }
}
