import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { EntityModule } from '../entity/entity.module';
import { InboxModule } from '../inbox/inbox.module';
import { IntegrationController } from './integration.controller';
import { INTEGRATION_SYNC_SERVICE, IntegrationService } from './integration.service';

@Module({
  imports: [DeviceModule, EntityModule, InboxModule],
  controllers: [IntegrationController],
  providers: [IntegrationService, { provide: INTEGRATION_SYNC_SERVICE, useExisting: IntegrationService }],
  exports: [INTEGRATION_SYNC_SERVICE],
})
export class IntegrationModule { }
