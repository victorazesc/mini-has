import { Module } from '@nestjs/common';
import { AppController, AutomationsController, DevicesController, DiscoveryController, EntitiesController, InboxController, IntegrationsController, IntegrationProvidersController, RoomsController, ScenesController } from './controllers';
import { CommandsService } from './commands';
import { DiscoveryService } from './discovery';
import { ProvidersService } from './providers';
import { HomeService } from './services';
import { StorageService } from './storage';
import { MqttService } from './mqtt';
import { FloorModule } from './modules/floor/floor.module';
import { CommonService } from './modules/common/common.service';

@Module({
  imports: [
    FloorModule,
  ],
  controllers: [
    AppController,
    AutomationsController,
    DevicesController,
    DiscoveryController,
    EntitiesController,
    InboxController,
    IntegrationProvidersController,
    IntegrationsController,
    RoomsController,
    ScenesController,
  ],
  providers: [CommandsService, DiscoveryService, HomeService, MqttService, ProvidersService, StorageService, CommonService],

})
export class AppModule { }
