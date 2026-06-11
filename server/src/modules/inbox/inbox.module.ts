import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { EntityModule } from '../entity/entity.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

export const INBOX_SERVICE = 'INBOX_SERVICE';

@Module({
  imports: [DeviceModule, EntityModule],
  controllers: [InboxController],
  providers: [InboxService, { provide: INBOX_SERVICE, useExisting: InboxService }],
  exports: [InboxService, INBOX_SERVICE],
})
export class InboxModule { }