import { Controller, Get, Post } from '@nestjs/common';
import { SolarService } from './solar.service';

@Controller('solar')
export class SolarController {
  constructor(private readonly solarService: SolarService) {}

  @Get('loggers')
  listLoggers() {
    return this.solarService.listLoggers();
  }

  @Post('scan')
  scanLoggers() {
    return this.solarService.scanLoggers();
  }
}
