import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { RoomModule } from '../room/room.module';
import { SceneController } from './scene.controller';
import { SceneService } from './scene.service';

@Module({
    imports: [RoomModule, DeviceModule],
    controllers: [SceneController],
    providers: [SceneService],
    exports: [SceneService],
})
export class SceneModule { }