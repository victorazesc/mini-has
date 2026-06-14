import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { JsonObject } from '../../types';

const SEGMENT_SECONDS = 5;
const PRE_ROLL_SECONDS = 5;
const POST_ROLL_SECONDS = 5;

type CameraWorker = {
    deviceId: number;
    segmentDirectory: string;
    recorder: ChildProcessWithoutNullStreams;
    detector: ChildProcessWithoutNullStreams;
    motionStartedAt?: number;
    lastMotionAt?: number;
    retainedSince?: number;
    finalizeTimer?: NodeJS.Timeout;
    stopping: boolean;
};

type CameraRecordingRow = {
    id: number;
    device_id: number;
    event_type: string;
    started_at: string;
    motion_started_at: string;
    ended_at: string;
    duration_seconds: number;
    file_path: string;
    thumbnail_path: string | null;
    metadata_json: string;
    created_at: string;
};

@Injectable()
export class CameraRecordingService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly workers = new Map<number, CameraWorker>();
    private readonly recordingRoot = resolve(process.cwd(), process.env.CAMERA_RECORDING_DIR || 'data/camera-recordings');
    private reconcileTimer?: NodeJS.Timeout;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(private readonly storage: StorageService) { }

    onApplicationBootstrap(): void {
        if (process.env.CAMERA_RECORDING_ENABLED === 'false') return;
        mkdirSync(this.recordingRoot, { recursive: true });
        const initialTimer = setTimeout(() => this.reconcileWorkers(), 3_000);
        initialTimer.unref();
        this.reconcileTimer = setInterval(() => this.reconcileWorkers(), 30_000);
        this.reconcileTimer.unref();
        this.cleanupTimer = setInterval(() => this.cleanup(), 10_000);
        this.cleanupTimer.unref();
    }

    onModuleDestroy(): void {
        if (this.reconcileTimer) clearInterval(this.reconcileTimer);
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        for (const worker of this.workers.values()) this.stopWorker(worker);
    }

    listRecordings(deviceId: number, date?: string): JsonObject[] {
        const params: unknown[] = [deviceId];
        let dateClause = '';
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const start = new Date(`${date}T00:00:00`);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            dateClause = 'AND started_at >= ? AND started_at < ?';
            params.push(start.toISOString(), end.toISOString());
        }
        return this.storage
            .all<CameraRecordingRow>(
                `SELECT * FROM camera_recordings WHERE device_id = ? ${dateClause} ORDER BY started_at DESC LIMIT 200`,
                params,
            )
            .map((row) => this.toRecording(row));
    }

    streamFile(deviceId: number, recordingId: number, kind: 'video' | 'thumbnail', request: any, response: any): boolean {
        const row = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ? AND device_id = ?',
            [recordingId, deviceId],
        );
        const filePath = kind === 'video' ? row?.file_path : row?.thumbnail_path;
        if (!filePath || !existsSync(filePath)) return false;

        const fileSize = statSync(filePath).size;
        const contentType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
        const range = kind === 'video' ? String(request.headers.range || '') : '';
        if (range) {
            const [startValue, endValue] = range.replace('bytes=', '').split('-');
            const start = Number(startValue || 0);
            const end = Math.min(Number(endValue || fileSize - 1), fileSize - 1);
            response.status(206);
            response.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Content-Length', end - start + 1);
            response.setHeader('Content-Type', contentType);
            createReadStream(filePath, { start, end }).pipe(response);
            return true;
        }

        response.status(200);
        response.setHeader('Content-Length', fileSize);
        response.setHeader('Content-Type', contentType);
        response.setHeader('Cache-Control', kind === 'video' ? 'no-store' : 'private, max-age=3600');
        createReadStream(filePath).pipe(response);
        return true;
    }

    private reconcileWorkers(): void {
        const cameras = this.storage.all<JsonObject>(
            `SELECT id, payload_json, capabilities_json, secrets_json
             FROM devices
             WHERE provider = 'onvif_camera' AND LOWER(device_type) IN ('camera', 'cam')`,
        );
        const cameraIds = new Set(cameras.map((camera) => Number(camera.id)));

        for (const worker of this.workers.values()) {
            if (!cameraIds.has(worker.deviceId)) this.stopWorker(worker);
        }
        for (const camera of cameras) {
            const deviceId = Number(camera.id);
            if (this.workers.has(deviceId)) continue;
            const urls = this.cameraUrls(camera);
            if (urls) this.startWorker(deviceId, urls.main, urls.low);
        }
    }

    private startWorker(deviceId: number, mainUrl: string, lowUrl: string): void {
        const segmentDirectory = join(this.recordingRoot, '.segments', String(deviceId));
        mkdirSync(segmentDirectory, { recursive: true });
        const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
        const recorder = spawn(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', mainUrl,
            '-map', '0:v:0', '-an', '-c:v', 'copy',
            '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1', '-strftime', '1',
            join(segmentDirectory, '%Y%m%d-%H%M%S.mkv'),
        ]);
        const detector = spawn(ffmpeg, [
            '-hide_banner', '-loglevel', 'info', '-rtsp_transport', 'tcp', '-i', lowUrl,
            '-an', '-vf', 'fps=2,scale=320:-2,select=gt(scene\\,0.025),metadata=print',
            '-f', 'null', '-',
        ]);
        const worker: CameraWorker = { deviceId, segmentDirectory, recorder, detector, stopping: false };
        this.workers.set(deviceId, worker);

        recorder.stdout.resume();
        recorder.stderr.resume();
        detector.stdout.resume();
        detector.stderr.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('lavfi.scene_score=')) this.markMotion(worker);
        });
        const failed = () => {
            if (worker.stopping) return;
            this.stopWorker(worker);
        };
        recorder.on('error', failed);
        detector.on('error', failed);
        recorder.on('exit', failed);
        detector.on('exit', failed);
    }

    private stopWorker(worker: CameraWorker): void {
        worker.stopping = true;
        if (worker.finalizeTimer) clearTimeout(worker.finalizeTimer);
        if (!worker.recorder.killed) worker.recorder.kill('SIGTERM');
        if (!worker.detector.killed) worker.detector.kill('SIGTERM');
        this.workers.delete(worker.deviceId);
    }

    private markMotion(worker: CameraWorker): void {
        const now = Date.now();
        worker.motionStartedAt ??= now;
        worker.lastMotionAt = now;
        if (worker.finalizeTimer) clearTimeout(worker.finalizeTimer);
        worker.finalizeTimer = setTimeout(
            () => void this.finalizeMotionEvent(worker),
            (POST_ROLL_SECONDS + SEGMENT_SECONDS + 1) * 1_000,
        );
        worker.finalizeTimer.unref();
    }

    private async finalizeMotionEvent(worker: CameraWorker): Promise<void> {
        const motionStartedAt = worker.motionStartedAt;
        const lastMotionAt = worker.lastMotionAt;
        const startedAt = motionStartedAt ? motionStartedAt - PRE_ROLL_SECONDS * 1_000 : 0;
        worker.retainedSince = startedAt;
        worker.motionStartedAt = undefined;
        worker.lastMotionAt = undefined;
        worker.finalizeTimer = undefined;
        if (!motionStartedAt || !lastMotionAt) {
            worker.retainedSince = undefined;
            return;
        }

        try {
            const endedAt = lastMotionAt + POST_ROLL_SECONDS * 1_000;
            const segments = this.segmentFiles(worker.segmentDirectory).filter((file) => {
                const modifiedAt = statSync(file).mtimeMs;
                return modifiedAt >= startedAt - SEGMENT_SECONDS * 1_000 && modifiedAt <= endedAt + SEGMENT_SECONDS * 2_000;
            });
            if (!segments.length) return;

            const eventDate = new Date(motionStartedAt);
            const eventDirectory = join(this.recordingRoot, String(worker.deviceId), eventDate.toISOString().slice(0, 10));
            mkdirSync(eventDirectory, { recursive: true });
            const eventName = eventDate.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
            const videoPath = join(eventDirectory, `${eventName}.mp4`);
            const thumbnailPath = join(eventDirectory, `${eventName}.jpg`);
            const concatPath = join(eventDirectory, `${eventName}.txt`);
            writeFileSync(concatPath, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));

            const copied = await this.runFfmpeg([
                '-hide_banner', '-loglevel', 'error',
                '-f', 'concat', '-safe', '0', '-i', concatPath,
                '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', videoPath,
            ]);
            rmSync(concatPath, { force: true });
            if (!copied || !existsSync(videoPath)) return;
            await this.runFfmpeg(['-hide_banner', '-loglevel', 'error', '-ss', String(PRE_ROLL_SECONDS), '-i', videoPath, '-frames:v', '1', '-q:v', '3', thumbnailPath]);

            const createdAt = this.storage.utcNow();
            const result = this.storage.run(
                `INSERT INTO camera_recordings
                 (device_id, event_type, started_at, motion_started_at, ended_at, duration_seconds, file_path, thumbnail_path, metadata_json, created_at)
                 VALUES (?, 'motion', ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    worker.deviceId,
                    new Date(startedAt).toISOString(),
                    new Date(motionStartedAt).toISOString(),
                    new Date(endedAt).toISOString(),
                    Math.max(1, Math.round((endedAt - startedAt) / 1_000)),
                    videoPath,
                    existsSync(thumbnailPath) ? thumbnailPath : null,
                    this.storage.jsonDump({ detector: 'local-frame-change', preRollSeconds: PRE_ROLL_SECONDS, postRollSeconds: POST_ROLL_SECONDS }),
                    createdAt,
                ],
            );
            this.storage.run(
                `INSERT INTO device_events (device_id, event_type, title, message, level, payload_json, created_at)
                 VALUES (?, 'camera_motion_recorded', 'Movimento gravado', 'A câmera registrou movimento.', 'info', ?, ?)`,
                [worker.deviceId, this.storage.jsonDump({ recordingId: Number(result.lastInsertRowid) }), createdAt],
            );
        } finally {
            worker.retainedSince = undefined;
        }
    }

    private cleanup(): void {
        const retentionDays = Math.max(1, Number(process.env.CAMERA_RECORDING_RETENTION_DAYS || 14));
        const retentionLimit = Date.now() - retentionDays * 86_400_000;
        const expired = this.storage.all<CameraRecordingRow>('SELECT * FROM camera_recordings WHERE ended_at < ?', [new Date(retentionLimit).toISOString()]);
        for (const recording of expired) {
            rmSync(recording.file_path, { force: true });
            if (recording.thumbnail_path) rmSync(recording.thumbnail_path, { force: true });
            this.storage.run('DELETE FROM camera_recordings WHERE id = ?', [recording.id]);
        }

        for (const worker of this.workers.values()) {
            const activeSince = worker.motionStartedAt ? worker.motionStartedAt - PRE_ROLL_SECONDS * 1_000 : undefined;
            const keepAfter = Math.min(
                activeSince ?? Number.POSITIVE_INFINITY,
                worker.retainedSince ?? Number.POSITIVE_INFINITY,
                Date.now() - (PRE_ROLL_SECONDS + SEGMENT_SECONDS * 2) * 1_000,
            );
            for (const file of this.segmentFiles(worker.segmentDirectory)) {
                if (statSync(file).mtimeMs < keepAfter) rmSync(file, { force: true });
            }
        }
    }

    private cameraUrls(camera: JsonObject): { main: string; low: string } | null {
        const payload = this.storage.jsonLoad<JsonObject>(String(camera.payload_json || ''), {});
        const capabilities = this.storage.jsonLoad<JsonObject>(String(camera.capabilities_json || ''), {});
        const secrets = this.storage.jsonLoad<JsonObject>(String(camera.secrets_json || ''), {});
        const ip = String(payload.ip || '').trim();
        if (!ip) return null;
        const port = Number(capabilities.rtspPort || 554);
        const path = String(capabilities.rtspPath || '/cam/realmonitor?channel=1&subtype=0').trim();
        const main = new URL(`rtsp://${ip}:${port}${path.startsWith('/') ? path : `/${path}`}`);
        main.username = String(secrets.username || '');
        main.password = String(secrets.password || '');
        main.searchParams.set('subtype', '0');
        const low = new URL(main);
        low.searchParams.set('subtype', '1');
        return { main: main.toString(), low: low.toString() };
    }

    private segmentFiles(directory: string): string[] {
        if (!existsSync(directory)) return [];
        return readdirSync(directory)
            .filter((file) => file.endsWith('.mkv'))
            .map((file) => join(directory, file))
            .sort();
    }

    private runFfmpeg(args: string[]): Promise<boolean> {
        return new Promise((resolveRun) => {
            const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: 'ignore' });
            ffmpeg.on('error', () => resolveRun(false));
            ffmpeg.on('exit', (code: number | null) => resolveRun(code === 0));
        });
    }

    private toRecording(row: CameraRecordingRow): JsonObject {
        return {
            id: row.id,
            deviceId: row.device_id,
            eventType: row.event_type,
            startedAt: row.started_at,
            motionStartedAt: row.motion_started_at,
            endedAt: row.ended_at,
            durationSeconds: row.duration_seconds,
            hasThumbnail: Boolean(row.thumbnail_path && existsSync(row.thumbnail_path)),
            metadata: this.storage.jsonLoad(row.metadata_json, {}),
        };
    }
}
