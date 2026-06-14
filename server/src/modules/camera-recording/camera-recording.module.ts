import { Module } from '@nestjs/common';
import { RoomModule } from '../room/room.module';
import { CameraRecordingController } from './camera-recording.controller';
import { CameraRecordingService } from './camera-recording.service';

@Module({
    imports: [RoomModule],
    controllers: [CameraRecordingController],
    providers: [CameraRecordingService],
})
export class CameraRecordingModule { }
