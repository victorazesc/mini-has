import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { CreateDiscoveryJobRequest } from '../../types';
import { CommonService } from '../common/common.service';
import { DiscoveryService } from './discovery.service';

@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly commonService: CommonService,
  ) {}

  @Post('jobs')
  createJob(@Body() body: CreateDiscoveryJobRequest) {
    return this.discoveryService.createJob(body);
  }

  @Get('jobs')
  listJobs() {
    return this.discoveryService.listJobs();
  }

  @Get('jobs/:job_id')
  getJob(@Param('job_id') jobId: string) {
    const job = this.discoveryService.getJob(jobId);
    if (!job) throw this.commonService.notFound('Discovery job not found');
    return job;
  }

  @Post('scan')
  async scanNow(@Body() body: CreateDiscoveryJobRequest, @Res({ passthrough: true }) response: any) {
    const { scanId, result } = await this.discoveryService.scanNow(body);
    response.setHeader('X-Discovery-Scan-Id', String(scanId));
    return result;
  }

  @Get('scans')
  listScans() {
    return this.discoveryService.listScans();
  }

  @Get('scans/:scan_id')
  getScan(@Param('scan_id') scanId: string) {
    const scan = this.discoveryService.getScan(Number(scanId));
    if (!scan) throw this.commonService.notFound('Discovery scan not found');
    return scan;
  }

  @Get('devices')
  listDevices() {
    return this.discoveryService.listDevices();
  }
}