import { Module } from '@nestjs/common';
import { AutomationModule } from './modules/automation/automation.module';
import { DeviceModule } from './modules/device/device.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { EntityModule } from './modules/entity/entity.module';
import { FloorModule } from './modules/floor/floor.module';
import { HealthModule } from './modules/health/health.module';
import { HomeModule } from './modules/home/home.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { IntegrationProviderModule } from './modules/integration-provider/integration-provider.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { RoomModule } from './modules/room/room.module';
import { SceneModule } from './modules/scene/scene.module';

@Module({
  imports: [
    HomeModule,
    HealthModule,
    SceneModule,
    AutomationModule,
    DeviceModule,
    EntityModule,
    InboxModule,
    IntegrationProviderModule,
    IntegrationModule,
    DiscoveryModule,
    FloorModule,
    RoomModule,
  ],
})
export class AppModule { }
