import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildCameraEventDescription,
  buildCameraEventSemantic,
  cameraSemanticRetryDelayMs,
  CameraRecordingService,
  CameraSemanticObservation,
  hasConfirmedCameraMotion,
  isCameraRecordingSelected,
  isPathInsideRecordingRoot,
  parseCameraRecordingRange,
  parseCameraRecordingSelection,
  resolveRecordingFileInsideRoot,
  shouldPersistCameraMotion,
} from '../src/modules/camera-recording/camera-recording.service';

test('semantic retry uses capped exponential backoff', () => {
  const fifteenMinutes = 15 * 60 * 1_000;

  assert.equal(cameraSemanticRetryDelayMs(fifteenMinutes, 1), fifteenMinutes);
  assert.equal(cameraSemanticRetryDelayMs(fifteenMinutes, 2), 30 * 60 * 1_000);
  assert.equal(cameraSemanticRetryDelayMs(fifteenMinutes, 5), 4 * 60 * 60 * 1_000);
  assert.equal(cameraSemanticRetryDelayMs(fifteenMinutes, 6), 6 * 60 * 60 * 1_000);
  assert.equal(cameraSemanticRetryDelayMs(fifteenMinutes, 20), 6 * 60 * 60 * 1_000);
});

test('camera recording is opt-in when the allowlist is empty', () => {
  const selection = parseCameraRecordingSelection(undefined);

  assert.equal(isCameraRecordingSelected(selection, 16), false);
  assert.equal(isCameraRecordingSelected(selection, 17), false);
});

test('camera recording accepts only valid positive device ids', () => {
  const selection = parseCameraRecordingSelection('16, invalid, -1, 17, 16');

  assert.deepEqual([...selection.ids], [16, 17]);
  assert.equal(isCameraRecordingSelected(selection, 16), true);
  assert.equal(isCameraRecordingSelected(selection, 17), true);
  assert.equal(isCameraRecordingSelected(selection, 18), false);
});

test('camera recording requires an explicit wildcard to select every camera', () => {
  const selection = parseCameraRecordingSelection('*');

  assert.equal(selection.all, true);
  assert.equal(isCameraRecordingSelected(selection, 999), true);
});

test('recording files must stay inside the configured root', () => {
  const root = '/var/lib/mini-has/server/camera-recordings';

  assert.equal(isPathInsideRecordingRoot(root, `${root}/16/clip.mp4`), true);
  assert.equal(isPathInsideRecordingRoot(root, root), false);
  assert.equal(isPathInsideRecordingRoot(root, '/etc/passwd'), false);
  assert.equal(isPathInsideRecordingRoot(root, `${root}/../mini-has.db`), false);
});

test('recording files cannot escape through a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-camera-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'mini-has-camera-outside-'));
  const validFile = join(root, 'clip.mp4');
  const outsideFile = join(outside, 'secret.txt');
  const escapedFile = join(root, 'escaped.mp4');
  writeFileSync(validFile, 'video');
  writeFileSync(outsideFile, 'secret');
  symlinkSync(outsideFile, escapedFile);

  try {
    assert.equal(resolveRecordingFileInsideRoot(root, validFile), realpathSync(validFile));
    assert.equal(resolveRecordingFileInsideRoot(root, escapedFile), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('camera recording ranges support iOS prefix, open and suffix requests', () => {
  assert.deepEqual(parseCameraRecordingRange('bytes=0-1', 1_000), { start: 0, end: 1 });
  assert.deepEqual(parseCameraRecordingRange('bytes=500-', 1_000), { start: 500, end: 999 });
  assert.deepEqual(parseCameraRecordingRange('bytes=-500', 1_000), { start: 500, end: 999 });
});

test('camera recording ranges reject impossible and multiple requests', () => {
  assert.equal(parseCameraRecordingRange('bytes=1000-', 1_000), undefined);
  assert.equal(parseCameraRecordingRange('bytes=20-10', 1_000), undefined);
  assert.equal(parseCameraRecordingRange('bytes=0-1,10-11', 1_000), undefined);
});

test('semantic tracker ignores rain/static objects and confirms moving objects', () => {
  const script = join(__dirname, '..', 'scripts', 'camera-object-detector.py');
  const result = spawnSync('python3', [script, '--self-test'], {
    encoding: 'utf8',
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-test: ok/);
});

test('describes a burgundy car passing from left to right', () => {
  const observation: CameraSemanticObservation = {
    id: 'track-1',
    kind: 'vehicle',
    class: 'car',
    color: { key: 'burgundy', label: 'bordô', confidence: 0.84, samples: 3 },
    firstSeenAt: '2026-07-29T18:10:32.000Z',
    lastSeenAt: '2026-07-29T18:10:37.000Z',
    maxScore: 0.82,
    trajectory: {
      entryEdge: 'left',
      direction: 'left_to_right',
      action: 'passed_by',
      confidence: 0.91,
      startCenter: [0.08, 0.42],
      endCenter: [0.89, 0.43],
      pathLength: 0.82,
      horizontalTravel: 0.81,
      horizontalReversals: 0,
      straightness: 0.98,
    },
  };

  assert.equal(
    buildCameraEventDescription([observation], 'Camera Frente'),
    'Um carro bordô passou da esquerda para a direita em frente à casa.',
  );
});

test('describes a gray car maneuvering after coming from the left', () => {
  const observation: CameraSemanticObservation = {
    id: 'track-2',
    kind: 'vehicle',
    class: 'car',
    color: { key: 'gray', label: 'cinza', confidence: 0.74, samples: 8 },
    firstSeenAt: '2026-07-29T17:51:32.000Z',
    lastSeenAt: '2026-07-29T17:51:56.000Z',
    maxScore: 0.79,
    trajectory: {
      entryEdge: 'left',
      direction: 'mixed',
      action: 'maneuvered',
      confidence: 0.87,
      startCenter: [0.09, 0.45],
      endCenter: [0.42, 0.45],
      pathLength: 0.89,
      horizontalTravel: 0.81,
      horizontalReversals: 2,
      straightness: 0.37,
    },
  };

  assert.equal(
    buildCameraEventDescription([observation], 'Camera Frente'),
    'Um carro cinza veio da esquerda e fez uma manobra em frente à casa.',
  );
});

test('keeps separate semantic observations for two cars', () => {
  const semantic = buildCameraEventSemantic([
    {
      trackId: 11,
      label: 'car',
      maxScore: 0.80,
      firstSeenAt: Date.parse('2026-07-29T18:00:00.000Z'),
      lastSeenAt: Date.parse('2026-07-29T18:00:03.000Z'),
      maxDisplacement: 0.42,
    },
    {
      trackId: 12,
      label: 'car',
      maxScore: 0.78,
      firstSeenAt: Date.parse('2026-07-29T18:00:05.000Z'),
      lastSeenAt: Date.parse('2026-07-29T18:00:08.000Z'),
      maxDisplacement: 0.39,
    },
  ], 'Camera Frente');

  assert.deepEqual(semantic.observations.map((item) => item.id), ['track-11', 'track-12']);
});

test('keeps unknown observations without adding them to the event description', () => {
  const semantic = buildCameraEventSemantic([
    {
      trackId: 21,
      label: 'car',
      maxScore: 0.86,
      firstSeenAt: Date.parse('2026-07-29T18:00:00.000Z'),
      lastSeenAt: Date.parse('2026-07-29T18:00:04.000Z'),
      maxDisplacement: 0.72,
      trajectory: {
        entryEdge: 'left',
        direction: 'left_to_right',
        action: 'passed_by',
        confidence: 0.90,
        pathLength: 0.72,
        horizontalTravel: 0.70,
        horizontalReversals: 0,
        straightness: 0.97,
      },
    },
    {
      trackId: 22,
      label: 'person',
      maxScore: 0.70,
      firstSeenAt: Date.parse('2026-07-29T18:00:01.000Z'),
      lastSeenAt: Date.parse('2026-07-29T18:00:04.000Z'),
      maxDisplacement: 0.02,
      trajectory: {
        entryEdge: 'center',
        direction: 'unknown',
        action: 'unknown',
        confidence: 0.20,
        pathLength: 0.02,
        horizontalTravel: 0.01,
        horizontalReversals: 0,
        straightness: 0.30,
      },
    },
  ], 'Camera Frente');

  assert.deepEqual(semantic.observations.map((item) => item.id), ['track-21', 'track-22']);
  assert.equal(
    semantic.description,
    'Um carro passou da esquerda para a direita em frente à casa.',
  );
});

test('persists detector-confirmed motion even when local trajectory is unknown', () => {
  const semantic = buildCameraEventSemantic([
    {
      trackId: 31,
      label: 'car',
      maxScore: 0.83,
      firstSeenAt: Date.parse('2026-07-29T18:00:00.000Z'),
      lastSeenAt: Date.parse('2026-07-29T18:00:12.000Z'),
      maxDisplacement: 0.02,
      trajectory: {
        entryEdge: 'center',
        direction: 'unknown',
        action: 'unknown',
        confidence: 0.18,
        pathLength: 0.03,
        horizontalTravel: 0.01,
        horizontalReversals: 18,
        straightness: 0.04,
      },
    },
  ], 'Camera Frente');

  assert.equal(hasConfirmedCameraMotion(semantic), true);
});

test('persists an ONVIF motion alert even when the local detector misses the object', () => {
  const semantic = buildCameraEventSemantic([], 'Camera Frente');

  assert.equal(shouldPersistCameraMotion(true, semantic, ['onvif']), true);
  assert.equal(shouldPersistCameraMotion(true, semantic, []), false);
});

test('does not call a plain pedestrian movement a maneuver', () => {
  const observation: CameraSemanticObservation = {
    id: 'track-32',
    kind: 'person',
    class: 'person',
    firstSeenAt: '2026-07-29T18:10:32.000Z',
    lastSeenAt: '2026-07-29T18:10:37.000Z',
    maxScore: 0.76,
    trajectory: {
      entryEdge: 'left',
      direction: 'mixed',
      action: 'maneuvered',
      confidence: 0.72,
      pathLength: 0.62,
      horizontalTravel: 0.48,
      horizontalReversals: 2,
      straightness: 0.51,
    },
  };

  assert.equal(
    buildCameraEventDescription([observation], 'Camera Frente'),
    'Uma pessoa mudou de direção em frente à casa.',
  );
});

test('storage pressure removes the oldest completed recording', () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-camera-recording-'));
  const eventDirectory = join(root, '16', '2026-07-29');
  const videoPath = join(eventDirectory, 'event.mp4');
  mkdirSync(eventDirectory, { recursive: true });
  writeFileSync(videoPath, 'video');

  const deletedIds: number[] = [];
  const storage = {
    all: () => [{
      id: 7,
      device_id: 16,
      event_type: 'motion',
      started_at: '2026-07-29T10:00:00.000Z',
      motion_started_at: '2026-07-29T10:00:05.000Z',
      ended_at: '2026-07-29T10:00:10.000Z',
      duration_seconds: 10,
      file_path: videoPath,
      thumbnail_path: null,
      metadata_json: '{}',
      created_at: '2026-07-29T10:00:10.000Z',
    }],
    run: (_sql: string, params: unknown[]) => {
      deletedIds.push(Number(params[0]));
      return {};
    },
    jsonLoad: (value: string) => JSON.parse(value),
  };
  const previous = {
    directory: process.env.CAMERA_RECORDING_DIR,
    requireMount: process.env.CAMERA_RECORDING_REQUIRE_MOUNT,
    minimumFree: process.env.CAMERA_RECORDING_MIN_FREE_GB,
  };
  process.env.CAMERA_RECORDING_DIR = root;
  process.env.CAMERA_RECORDING_REQUIRE_MOUNT = 'false';
  process.env.CAMERA_RECORDING_MIN_FREE_GB = '100000';

  try {
    const service = new CameraRecordingService(storage as never);
    (service as unknown as { cleanup(): void }).cleanup();

    assert.equal(existsSync(videoPath), false);
    assert.deepEqual(deletedIds, [7]);
  } finally {
    if (previous.directory === undefined) delete process.env.CAMERA_RECORDING_DIR;
    else process.env.CAMERA_RECORDING_DIR = previous.directory;
    if (previous.requireMount === undefined) delete process.env.CAMERA_RECORDING_REQUIRE_MOUNT;
    else process.env.CAMERA_RECORDING_REQUIRE_MOUNT = previous.requireMount;
    if (previous.minimumFree === undefined) delete process.env.CAMERA_RECORDING_MIN_FREE_GB;
    else process.env.CAMERA_RECORDING_MIN_FREE_GB = previous.minimumFree;
    rmSync(root, { recursive: true, force: true });
  }
});

test('storage pressure preserves a recording until its Drive upload is confirmed', () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-camera-cloud-pending-'));
  const eventDirectory = join(root, '16', '2026-07-30');
  const videoPath = join(eventDirectory, 'event.mp4');
  mkdirSync(eventDirectory, { recursive: true });
  writeFileSync(videoPath, 'video');
  const row = {
    id: 8,
    device_id: 16,
    event_type: 'motion',
    started_at: '2026-07-30T10:00:00.000Z',
    motion_started_at: '2026-07-30T10:00:05.000Z',
    ended_at: '2026-07-30T10:00:10.000Z',
    duration_seconds: 10,
    file_path: videoPath,
    thumbnail_path: null,
    metadata_json: JSON.stringify({
      cloudStorage: { provider: 'google_drive', status: 'pending', attempts: 0 },
    }),
    created_at: '2026-07-30T10:00:10.000Z',
  };
  const deletedIds: number[] = [];
  const storage = {
    all: () => [row],
    run: (_sql: string, params: unknown[]) => {
      deletedIds.push(Number(params[0]));
      return {};
    },
    jsonLoad: (value: string) => JSON.parse(value),
  };
  const keys = [
    'CAMERA_RECORDING_DIR',
    'CAMERA_RECORDING_REQUIRE_MOUNT',
    'CAMERA_RECORDING_MIN_FREE_GB',
    'CAMERA_CLOUD_STORAGE',
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CAMERA_RECORDING_DIR = root;
  process.env.CAMERA_RECORDING_REQUIRE_MOUNT = 'false';
  process.env.CAMERA_RECORDING_MIN_FREE_GB = '100000';
  process.env.CAMERA_CLOUD_STORAGE = 'google_drive';
  process.env.GOOGLE_DRIVE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'client-secret';
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = 'refresh-token';

  try {
    const service = new CameraRecordingService(storage as never);
    (service as unknown as { cleanup(): void }).cleanup();

    assert.equal(existsSync(videoPath), true);
    assert.deepEqual(deletedIds, []);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup removes only stale incomplete camera artifacts after an interrupted finalization', () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-camera-incomplete-'));
  const eventDirectory = join(root, '16', '2026-07-30');
  const partialPath = join(eventDirectory, 'event.partial.mp4');
  const concatPath = join(eventDirectory, 'event.txt');
  const finalPath = join(eventDirectory, 'event.mp4');
  mkdirSync(eventDirectory, { recursive: true });
  writeFileSync(partialPath, 'partial');
  writeFileSync(concatPath, 'concat');
  writeFileSync(finalPath, 'complete');
  const stale = new Date(Date.now() - 2 * 60 * 60_000);
  utimesSync(partialPath, stale, stale);
  utimesSync(concatPath, stale, stale);
  const storage = {
    all: () => [],
    run: () => ({}),
  };
  const previous = {
    directory: process.env.CAMERA_RECORDING_DIR,
    requireMount: process.env.CAMERA_RECORDING_REQUIRE_MOUNT,
    minimumFree: process.env.CAMERA_RECORDING_MIN_FREE_GB,
  };
  process.env.CAMERA_RECORDING_DIR = root;
  process.env.CAMERA_RECORDING_REQUIRE_MOUNT = 'false';
  process.env.CAMERA_RECORDING_MIN_FREE_GB = '1';

  try {
    const service = new CameraRecordingService(storage as never);
    (service as unknown as { cleanup(): void }).cleanup();

    assert.equal(existsSync(partialPath), false);
    assert.equal(existsSync(concatPath), false);
    assert.equal(existsSync(finalPath), true);
  } finally {
    if (previous.directory === undefined) delete process.env.CAMERA_RECORDING_DIR;
    else process.env.CAMERA_RECORDING_DIR = previous.directory;
    if (previous.requireMount === undefined) delete process.env.CAMERA_RECORDING_REQUIRE_MOUNT;
    else process.env.CAMERA_RECORDING_REQUIRE_MOUNT = previous.requireMount;
    if (previous.minimumFree === undefined) delete process.env.CAMERA_RECORDING_MIN_FREE_GB;
    else process.env.CAMERA_RECORDING_MIN_FREE_GB = previous.minimumFree;
    rmSync(root, { recursive: true, force: true });
  }
});
