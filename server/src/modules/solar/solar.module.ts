import { Module } from '@nestjs/common';
import { SolarController } from './solar.controller';
import { SolarService } from './solar.service';

@Module({
  controllers: [SolarController],
  providers: [SolarService],
})
export class SolarModule {}
