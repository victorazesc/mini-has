import { Controller, Get, Post, Query } from '@nestjs/common';
import { SolarService } from './solar.service';

@Controller('solar')
export class SolarController {
  constructor(private readonly solarService: SolarService) {}

  @Get('loggers')
  listLoggers() {
    return this.solarService.listLoggers();
  }

  @Get('history')
  listHistory(@Query('range') range?: string, @Query('bucket') bucket?: string, @Query('ip') ip?: string) {
    return this.solarService.listHistory({ range, bucket, ip });
  }

  @Post('scan')
  scanLoggers() {
    return this.solarService.scanLoggers();
  }
}
