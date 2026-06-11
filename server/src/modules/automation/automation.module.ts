import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { EntityModule } from '../entity/entity.module';
import { RoomModule } from '../room/room.module';
import { SceneModule } from '../scene/scene.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

export const AUTOMATION_SERVICE = 'AUTOMATION_SERVICE';

@Module({
    imports: [RoomModule, SceneModule, DeviceModule, EntityModule],
    controllers: [AutomationController],
    providers: [AutomationService, { provide: AUTOMATION_SERVICE, useExisting: AutomationService }],
    exports: [AutomationService, AUTOMATION_SERVICE],
})
export class AutomationModule { }