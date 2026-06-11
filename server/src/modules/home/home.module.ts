import { Global, Module } from '@nestjs/common';
import { CommandsService } from '../../infrastructure/commands/commands.service';
import { DiscoveryService } from '../../infrastructure/discovery/discovery-runner.service';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { ProvidersService } from '../../infrastructure/providers/providers.service';
import { CommonService } from '../common/common.service';
import { RoomModule } from '../room/room.module';

@Global()
@Module({
    imports: [RoomModule],
    providers: [MqttService, ProvidersService, CommandsService, DiscoveryService, CommonService],
    exports: [RoomModule, ProvidersService, CommandsService, DiscoveryService, CommonService],
})
export class HomeModule { }