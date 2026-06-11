import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InboxStatus, JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { InboxService } from './inbox.service';

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inboxService: InboxService,
    private readonly commonService: CommonService,
  ) {}

  @Get('devices')
  listInboxDevices(@Query('status') status?: InboxStatus, @Query('provider') provider?: string) {
    return this.inboxService.listInboxDevices(status || undefined, provider || undefined);
  }

  @Post('devices/:inbox_id/accept')
  acceptInboxDevice(@Param('inbox_id') inboxId: string, @Body() body: JsonObject) {
    const device = this.inboxService.acceptInboxDevice(Number(inboxId), body);
    if (!device) throw this.commonService.notFound('Inbox device not found');
    return device;
  }

  @Post('devices/:inbox_id/ignore')
  ignoreInboxDevice(@Param('inbox_id') inboxId: string) {
    const inbox = this.inboxService.ignoreInboxDevice(Number(inboxId));
    if (!inbox) throw this.commonService.notFound('Inbox device not found');
    return inbox;
  }
}