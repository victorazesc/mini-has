import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { InboxModule } from '../inbox/inbox.module';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';

@Module({
  imports: [DeviceModule, InboxModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationModule { }