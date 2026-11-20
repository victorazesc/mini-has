import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  CameraRecordingHealth,
  CameraRecordingService,
} from '../src/modules/camera-recording/camera-recording.service';
import { HealthService } from '../src/modules/health/health.service';

function healthService(snapshot: CameraRecordingHealth): HealthService {
  return new HealthService({
    healthSnapshot: () => snapshot,
  } as CameraRecordingService);
}

test('health reports the camera pipeline details when recording is healthy', () => {
  const result = healthService({
    status: 'ok',
    required: true,
    enabled: true,
    expectedWorkers: 1,
    activeWorkers: 1,
    healthyWorkers: 1,
    issues: [],
  }).health();

  assert.equal(result.status, 'ok');
  assert.equal(result.cameras.healthyWorkers, 1);
});

test('health fails when a required camera pipeline is stale', () => {
  const service = healthService({
    status: 'degraded',
    required: true,
    enabled: true,
    expectedWorkers: 1,
    activeWorkers: 1,
    healthyWorkers: 0,
    issues: ['pipeline_stale'],
  });

  assert.throws(
    () => service.health(),
    (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      assert.equal(error.getStatus(), 503);
      return true;
    },
  );
});

