import { Module } from '@nestjs/common';
import { AppController, DevicesController, DiscoveryController, EntitiesController, InboxController, IntegrationsController, IntegrationProvidersController, RoomsController } from './controllers';
import { CommandsService } from './commands';
import { DiscoveryService } from './discovery';
import { ProvidersService } from './providers';
import { HomeService } from './services';
import { StorageService } from './storage';

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
  ],
  providers: [CommandsService, DiscoveryService, HomeService, ProvidersService, StorageService],
})
export class AppModule {}
