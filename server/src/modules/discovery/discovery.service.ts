import { Injectable } from '@nestjs/common';
import { CreateDiscoveryJobRequest } from '../../types';
import { DiscoveryService as DiscoveryRunnerService } from '../../infrastructure/discovery/discovery-runner.service';

@Injectable()
export class DiscoveryService {
  constructor(private readonly discovery: DiscoveryRunnerService) { }

  createJob(body: CreateDiscoveryJobRequest) {
    const job = this.discovery.createDiscoveryJob(body);
    void this.discovery.runDiscoveryJob(job.id, body);
    return { job_id: job.id, status: job.status };
  }

  listJobs() {
    return this.discovery.listJobs();
  }

  getJob(jobId: string) {
    return this.discovery.getJob(jobId);
  }

  scanNow(body: CreateDiscoveryJobRequest) {
    return this.discovery.scanNow(body);
  }

  listScans() {
    return this.discovery.listSavedScans();
  }

  getScan(scanId: number) {
    return this.discovery.getSavedScan(scanId);
  }

  listDevices() {
    return this.discovery.listSavedDevices();
  }
}