import { Module } from '@nestjs/common';
import { AppController, DevicesController, DiscoveryController, EntitiesController, InboxController, IntegrationsController, IntegrationProvidersController, RoomsController, ScenesController } from './controllers';
import { CommandsService } from './commands';
import { DiscoveryService } from './discovery';
import { ProvidersService } from './providers';
import { HomeService } from './services';
import { StorageService } from './storage';
import { MqttService } from './mqtt';

@Module({
  controllers: [
    AppController,
    DevicesController,
    DiscoveryController,
    EntitiesController,
    InboxController,
    IntegrationProvidersController,
    IntegrationsController,
    RoomsController,
    ScenesController,
  ],
  providers: [CommandsService, DiscoveryService, HomeService, MqttService, ProvidersService, StorageService],
})
export class AppModule {}
