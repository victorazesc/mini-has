import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import {
    accessSync,
    constants as fsConstants,
    createReadStream,
    existsSync,
    mkdirSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    statfsSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createConnection, Socket } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { OnvifCameraClient } from '../../infrastructure/providers/onvif-camera.client';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { JsonObject } from '../../types';
import {
    CameraSemanticAnalyzer,
    CameraVideoSemantic,
} from './camera-semantic-analyzer';
import { GoogleDriveStorage } from './google-drive-storage';

const SEGMENT_SECONDS = 5;
const PRE_ROLL_SECONDS = 5;
const POST_ROLL_SECONDS = 5;
const GIBIBYTE = 1024 ** 3;
const OBJECT_DETECTOR_MODEL_SHA256 = '33a3b622c7cac0762f96089353cd61495f3e993968d133af7871bfc2d5396704';
const CAMERA_WORKER_GRACE_MS = 30_000;
const CAMERA_HEARTBEAT_STALE_MS = 20_000;
const CAMERA_SEGMENT_STALE_MS = 20_000;
const SEMANTIC_PENDING_DESCRIPTION = 'Movimento gravado. Análise detalhada em andamento.';
const SEMANTIC_DEFERRED_DESCRIPTION = 'Movimento gravado. Análise detalhada aguardando disponibilidade.';
const SEMANTIC_FAILED_DESCRIPTION = 'Movimento gravado. Não foi possível concluir a análise detalhada.';
const LOCAL_UNCONFIRMED_DESCRIPTION = 'Movimento gravado. A descrição detalhada não foi confirmada.';
const SEMANTIC_RETRY_MAX_MS = 6 * 60 * 60 * 1_000;

export type CameraRecordingSelection = {
    all: boolean;
    ids: ReadonlySet<number>;
};

export type CameraRecordingHealth = {
    status: 'ok' | 'starting' | 'degraded' | 'disabled';
    required: boolean;
    enabled: boolean;
    expectedWorkers: number;
    activeWorkers: number;
    healthyWorkers: number;
    issues: string[];
    lastHeartbeatAt?: string;
    lastSegmentAt?: string;
    lastEventAt?: string;
};

export type CameraObjectColor = {
    key: 'black' | 'blue' | 'brown' | 'burgundy' | 'gray' | 'red' | 'white' | 'unknown';
    label: string;
    confidence: number;
    samples: number;
};

export type CameraObjectTrajectory = {
    entryEdge: 'left' | 'right' | 'center' | 'unknown';
    direction: 'left_to_right' | 'right_to_left' | 'mixed' | 'unknown';
    action: 'passed_by' | 'maneuvered' | 'moving' | 'unknown';
    confidence: number;
    startCenter?: [number, number];
    endCenter?: [number, number];
    pathLength: number;
    horizontalTravel: number;
    horizontalReversals: number;
    straightness: number;
    meanArea?: number;
    maximumArea?: number;
};

export type CameraObjectEvidence = {
    trackId?: number;
    label: string;
    maxScore: number;
    firstSeenAt: number;
    lastSeenAt: number;
    maxDisplacement: number;
    color?: CameraObjectColor;
    trajectory?: CameraObjectTrajectory;
};

export type CameraSemanticObservation = {
    id: string;
    kind: 'vehicle' | 'person' | 'animal' | 'object';
    class: string;
    color?: CameraObjectColor;
    firstSeenAt: string;
    lastSeenAt: string;
    maxScore: number;
    trajectory?: CameraObjectTrajectory;
};

export type CameraEventSemantic = {
    version: 1;
    status: 'complete';
    language: 'pt-BR';
    analyzer: { name: 'local-vehicle-event'; version: 1 };
    description: string;
    confidence: number;
    facts: string[];
    observations: CameraSemanticObservation[];
};

export function parseCameraRecordingSelection(value: string | undefined): CameraRecordingSelection {
    const normalized = String(value || '').trim();
    if (normalized === '*') return { all: true, ids: new Set() };

    const ids = new Set(
        normalized
            .split(',')
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isSafeInteger(item) && item > 0),
    );
    return { all: false, ids };
}

export function isCameraRecordingSelected(selection: CameraRecordingSelection, deviceId: number): boolean {
    return selection.all || selection.ids.has(deviceId);
}

export function cameraSemanticRetryDelayMs(baseDelayMs: number, attempts: number): number {
    const safeBaseDelayMs = Math.max(1_000, Math.floor(baseDelayMs));
    const exponent = Math.min(5, Math.max(0, Math.floor(attempts) - 1));
    return Math.min(
        safeBaseDelayMs * (2 ** exponent),
        Math.max(safeBaseDelayMs, SEMANTIC_RETRY_MAX_MS),
    );
}

export function isPathInsideRecordingRoot(recordingRoot: string, filePath: string): boolean {
    const pathFromRoot = relative(resolve(recordingRoot), resolve(filePath));
    return Boolean(pathFromRoot) && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

export function resolveRecordingFileInsideRoot(
    recordingRoot: string,
    filePath: string,
): string | undefined {
    if (!isPathInsideRecordingRoot(recordingRoot, filePath)) return undefined;
    try {
        const resolvedRoot = realpathSync(recordingRoot);
        const resolvedFile = realpathSync(filePath);
        if (!isPathInsideRecordingRoot(resolvedRoot, resolvedFile)) return undefined;
        return statSync(resolvedFile).isFile() ? resolvedFile : undefined;
    } catch {
        return undefined;
    }
}

export function parseCameraRecordingRange(
    value: string,
    fileSize: number,
): { start: number; end: number } | undefined {
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || value.includes(',')) return undefined;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match || (!match[1] && !match[2])) return undefined;

    if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
        return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
    if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(requestedEnd)
        || start < 0
        || start >= fileSize
        || requestedEnd < start
    ) {
        return undefined;
    }
    return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

export function buildCameraEventSemantic(
    evidence: CameraObjectEvidence[],
    cameraName: string,
): CameraEventSemantic {
    const allObservations = evidence.map((item, index): CameraSemanticObservation => ({
        id: item.trackId ? `track-${item.trackId}` : `object-${index + 1}`,
        kind: semanticKind(item.label),
        class: item.label,
        ...(item.color ? { color: item.color } : {}),
        firstSeenAt: new Date(item.firstSeenAt).toISOString(),
        lastSeenAt: new Date(item.lastSeenAt).toISOString(),
        maxScore: item.maxScore,
        ...(item.trajectory ? { trajectory: item.trajectory } : {}),
    }));
    const descriptiveObservations = allObservations.filter(
        (observation) => observation.trajectory?.action !== 'unknown',
    );
    const observations = allObservations;
    const descriptionObservations = descriptiveObservations.length
        ? descriptiveObservations
        : allObservations;
    const confidenceValues = observations.flatMap((observation) => [
        observation.maxScore,
        observation.trajectory?.confidence,
        observation.color?.confidence,
    ]).filter((value): value is number => Number.isFinite(value));
    const confidence = confidenceValues.length
        ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
        : 0;
    const facts = new Set<string>();
    for (const observation of observations) {
        facts.add(`${observation.kind}_detected`);
        if (observation.trajectory?.action === 'passed_by') facts.add(`${observation.kind}_passed_by`);
        if (observation.trajectory?.action === 'maneuvered') facts.add(`${observation.kind}_maneuvered`);
    }

    return {
        version: 1,
        status: 'complete',
        language: 'pt-BR',
        analyzer: { name: 'local-vehicle-event', version: 1 },
        description: buildCameraEventDescription(descriptionObservations, cameraName),
        confidence: Math.round(confidence * 10_000) / 10_000,
        facts: [...facts],
        observations,
    };
}

export function hasConfirmedCameraMotion(semantic: CameraEventSemantic): boolean {
    // The detector only emits object_motion after confirming an allowed class
    // across multiple frames. Trajectory classification is descriptive and may
    // remain unknown for short, distant or partially occluded real events.
    return semantic.observations.length > 0;
}

export function shouldPersistCameraMotion(
    objectDetectionEnabled: boolean,
    semantic: CameraEventSemantic,
    motionSources: readonly string[],
): boolean {
    return (
        !objectDetectionEnabled
        || hasConfirmedCameraMotion(semantic)
        || motionSources.includes('onvif')
    );
}

export function buildCameraEventDescription(
    observations: CameraSemanticObservation[],
    cameraName: string,
): string {
    if (!observations.length) return 'Movimento detectado diante da câmera.';
    return observations
        .slice(0, 5)
        .map((observation) => describeObservation(observation, cameraName))
        .join(' ');
}

function semanticKind(label: string): CameraSemanticObservation['kind'] {
    if (['car', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(label)) return 'vehicle';
    if (label === 'person') return 'person';
    if (['cat', 'dog'].includes(label)) return 'animal';
    return 'object';
}

function describeObservation(observation: CameraSemanticObservation, cameraName: string): string {
    const grammarByClass: Record<string, { article: string; noun: string; detected: string }> = {
        person: { article: 'uma', noun: 'pessoa', detected: 'detectada' },
        bicycle: { article: 'uma', noun: 'bicicleta', detected: 'detectada' },
        motorcycle: { article: 'uma', noun: 'moto', detected: 'detectada' },
        car: { article: 'um', noun: 'carro', detected: 'detectado' },
        truck: { article: 'um', noun: 'caminhão', detected: 'detectado' },
        bus: { article: 'um', noun: 'ônibus', detected: 'detectado' },
        dog: { article: 'um', noun: 'cachorro', detected: 'detectado' },
        cat: { article: 'um', noun: 'gato', detected: 'detectado' },
    };
    const grammar = grammarByClass[observation.class]
        || { article: 'um', noun: 'objeto', detected: 'detectado' };
    const color = observation.color;
    const colorText = color && color.key !== 'unknown' && color.confidence >= 0.40
        ? ` ${color.confidence < 0.68 ? 'aparentemente ' : ''}${color.label}`
        : '';
    const subject = `${grammar.article} ${grammar.noun}${colorText}`;
    const capitalizedSubject = subject.charAt(0).toUpperCase() + subject.slice(1);
    const location = cameraLocation(cameraName);
    const trajectory = observation.trajectory;

    if (trajectory?.action === 'maneuvered' && observation.kind !== 'person') {
        const origin = trajectory.entryEdge === 'left'
            ? 'veio da esquerda e '
            : trajectory.entryEdge === 'right'
                ? 'veio da direita e '
                : '';
        return `${capitalizedSubject} ${origin}fez uma manobra ${location}.`;
    }
    if (trajectory?.action === 'maneuvered') {
        return `${capitalizedSubject} mudou de direção ${location}.`;
    }
    if (trajectory?.action === 'passed_by') {
        const direction = trajectory.direction === 'left_to_right'
            ? ' da esquerda para a direita'
            : trajectory.direction === 'right_to_left'
                ? ' da direita para a esquerda'
                : '';
        return `${capitalizedSubject} passou${direction} ${location}.`;
    }
    if (trajectory?.direction === 'left_to_right') {
        return `${capitalizedSubject} se deslocou da esquerda para a direita ${location}.`;
    }
    if (trajectory?.direction === 'right_to_left') {
        return `${capitalizedSubject} se deslocou da direita para a esquerda ${location}.`;
    }
    return `${capitalizedSubject} foi ${grammar.detected} em movimento ${location}.`;
}

function cameraLocation(cameraName: string): string {
    const normalized = cameraName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (normalized.includes('frente') || normalized.includes('entrada')) return 'em frente à casa';
    if (normalized.includes('fundo')) return 'nos fundos da casa';
    return 'diante da câmera';
}

function parseObjectColor(value: unknown): CameraObjectColor | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as JsonObject;
    const allowedKeys: CameraObjectColor['key'][] = [
        'black', 'blue', 'brown', 'burgundy', 'gray', 'red', 'white', 'unknown',
    ];
    const key = String(item.key || '') as CameraObjectColor['key'];
    const confidence = Number(item.confidence);
    const samples = Number(item.samples);
    if (
        !allowedKeys.includes(key)
        || !Number.isFinite(confidence)
        || confidence < 0
        || confidence > 1
        || !Number.isSafeInteger(samples)
        || samples < 0
        || samples > 10_000
    ) {
        return undefined;
    }
    return {
        key,
        label: String(item.label || '').trim().slice(0, 40) || 'cor não identificada',
        confidence,
        samples,
    };
}

function parseObjectTrajectory(value: unknown): CameraObjectTrajectory | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as JsonObject;
    const entryEdges: CameraObjectTrajectory['entryEdge'][] = ['left', 'right', 'center', 'unknown'];
    const directions: CameraObjectTrajectory['direction'][] = [
        'left_to_right', 'right_to_left', 'mixed', 'unknown',
    ];
    const actions: CameraObjectTrajectory['action'][] = [
        'passed_by', 'maneuvered', 'moving', 'unknown',
    ];
    const entryEdge = String(item.entryEdge || '') as CameraObjectTrajectory['entryEdge'];
    const direction = String(item.direction || '') as CameraObjectTrajectory['direction'];
    const action = String(item.action || '') as CameraObjectTrajectory['action'];
    const confidence = Number(item.confidence);
    const pathLength = Number(item.pathLength);
    const horizontalTravel = Number(item.horizontalTravel);
    const horizontalReversals = Number(item.horizontalReversals);
    const straightness = Number(item.straightness);
    const meanArea = Number(item.meanArea);
    const maximumArea = Number(item.maximumArea);
    if (
        !entryEdges.includes(entryEdge)
        || !directions.includes(direction)
        || !actions.includes(action)
        || ![confidence, pathLength, horizontalTravel, straightness].every(Number.isFinite)
        || confidence < 0
        || confidence > 1
        || pathLength < 0
        || pathLength > 100
        || horizontalTravel < 0
        || horizontalTravel > 100
        || straightness < 0
        || straightness > 1
        || !Number.isSafeInteger(horizontalReversals)
        || horizontalReversals < 0
        || horizontalReversals > 10_000
    ) {
        return undefined;
    }
    const startCenter = parseNormalizedPoint(item.startCenter);
    const endCenter = parseNormalizedPoint(item.endCenter);
    return {
        entryEdge,
        direction,
        action,
        confidence,
        ...(startCenter ? { startCenter } : {}),
        ...(endCenter ? { endCenter } : {}),
        pathLength,
        horizontalTravel,
        horizontalReversals,
        straightness,
        ...(Number.isFinite(meanArea) && meanArea >= 0 && meanArea <= 1 ? { meanArea } : {}),
        ...(Number.isFinite(maximumArea) && maximumArea >= 0 && maximumArea <= 1
            ? { maximumArea }
            : {}),
    };
}

function parseNormalizedPoint(value: unknown): [number, number] | undefined {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) return undefined;
    return [x, y];
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
    if (!value?.trim()) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
}

type CameraWorker = {
    deviceId: number;
    cameraName: string;
    segmentDirectory: string;
    recorder: ChildProcessWithoutNullStreams;
    detector: ChildProcessWithoutNullStreams;
    classifier?: Socket;
    classifierBuffer: string;
    classifierReady: boolean;
    classifierReadyTimer?: NodeJS.Timeout;
    objectEvidence: Map<string, CameraObjectEvidence>;
    inferenceCount: number;
    inferenceTotalMs: number;
    inferenceMaxMs: number;
    startedAt: number;
    lastDetectorHeartbeatAt?: number;
    lastSegmentAt?: number;
    motionStartedAt?: number;
    lastMotionAt?: number;
    motionSources: Set<CameraMotionSource>;
    retainedSince?: number;
    finalizeTimer?: NodeJS.Timeout;
    finalizing: boolean;
    stopping: boolean;
    onvif?: OnvifCameraClient;
    onvifSubscriptionUrl?: string;
};

type CameraMotionSource = 'object' | 'scene' | 'onvif';

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

type CameraSemanticJob = {
    deviceId: number;
    eventId: number;
    recordingId: number;
    videoPath: string;
    cameraName: string;
};

type CameraCloudState = {
    provider: 'google_drive';
    status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'deleting';
    attempts: number;
    fileId?: string;
    size?: number;
    md5Checksum?: string;
    uploadedAt?: string;
    localVideoReleasedAt?: string;
    nextAttemptAt?: string;
    lastError?: string;
};

@Injectable()
export class CameraRecordingService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(CameraRecordingService.name);
    private readonly workers = new Map<number, CameraWorker>();
    private readonly recordingRoot = resolve(process.cwd(), process.env.CAMERA_RECORDING_DIR || 'data/camera-recordings');
    private readonly segmentRoot = resolve(
        process.env.CAMERA_RECORDING_SEGMENT_DIR || join(this.recordingRoot, '.segments'),
    );
    private readonly recordingEnabled = process.env.CAMERA_RECORDING_ENABLED === 'true';
    private readonly recordingRequired = process.env.CAMERA_RECORDING_REQUIRED === 'true';
    private readonly cameraSelection = parseCameraRecordingSelection(process.env.CAMERA_RECORDING_DEVICE_IDS);
    private readonly requireMount = process.env.CAMERA_RECORDING_REQUIRE_MOUNT !== 'false';
    private readonly retentionDays = boundedNumber(process.env.CAMERA_RECORDING_RETENTION_DAYS, 14, 1, 3650);
    private readonly maxStorageBytes = boundedNumber(process.env.CAMERA_RECORDING_MAX_GB, 500, 1, 100_000) * GIBIBYTE;
    private readonly minimumFreeBytes = boundedNumber(process.env.CAMERA_RECORDING_MIN_FREE_GB, 100, 1, 100_000) * GIBIBYTE;
    private readonly ringBufferMs = boundedNumber(
        process.env.CAMERA_RECORDING_RING_BUFFER_SECONDS,
        600,
        30,
        1_800,
    ) * 1_000;
    private readonly objectDetectionEnabled = process.env.CAMERA_OBJECT_DETECTION_ENABLED === 'true';
    private readonly onvifMotionEnabled = process.env.CAMERA_ONVIF_MOTION_ENABLED !== 'false';
    private readonly cameraAiSocket = process.env.CAMERA_AI_SOCKET || '/run/mini-has-camera-ai/detector.sock';
    private readonly objectDetectorFps = boundedNumber(process.env.CAMERA_OBJECT_DETECTOR_FPS, 1, 0.2, 5);
    private readonly objectMinimumScore = boundedNumber(process.env.CAMERA_OBJECT_MIN_SCORE, 0.56, 0.01, 1);
    private readonly semanticAnalyzer = new CameraSemanticAnalyzer();
    private readonly cloudStorage = new GoogleDriveStorage();
    private readonly cloudRetentionDays = boundedNumber(
        process.env.CAMERA_CLOUD_RETENTION_DAYS,
        15,
        1,
        3650,
    );
    private readonly cloudLocalRetentionMs = boundedNumber(
        process.env.CAMERA_CLOUD_LOCAL_RETENTION_HOURS,
        24,
        1,
        720,
    ) * 3_600_000;
    private readonly cloudRetryMs = boundedNumber(
        process.env.CAMERA_CLOUD_RETRY_MINUTES,
        5,
        1,
        1_440,
    ) * 60_000;
    private readonly activeWarnings = new Set<string>();
    private readonly serviceStartedAt = Date.now();
    private reconcileTimer?: NodeJS.Timeout;
    private cleanupTimer?: NodeJS.Timeout;
    private semanticRecoveryTimer?: NodeJS.Timeout;
    private cloudRecoveryTimer?: NodeJS.Timeout;
    private ffmpegAvailable = false;
    private lastFfmpegCheckAt = 0;
    private lastIncompleteArtifactCleanupAt = 0;
    private semanticQueue = Promise.resolve();
    private semanticQueueDepth = 0;
    private semanticStopped = false;
    private semanticBackoffUntil = 0;
    private readonly semanticQueuedRecordingIds = new Set<number>();
    private cloudQueue = Promise.resolve();
    private readonly cloudQueuedRecordingIds = new Set<number>();
    private readonly semanticRetryMs = boundedNumber(
        process.env.CAMERA_SEMANTIC_RETRY_MINUTES,
        15,
        1,
        1_440,
    ) * 60_000;

    constructor(private readonly storage: StorageService) { }

    onApplicationBootstrap(): void {
        const rawRecordingEnabled = String(process.env.CAMERA_RECORDING_ENABLED || '').trim();
        if (rawRecordingEnabled && !['true', 'false'].includes(rawRecordingEnabled)) {
            this.logger.error(
                `CAMERA_RECORDING_ENABLED invalido (${rawRecordingEnabled.length} caracteres); gravacao desativada.`,
            );
        }
        if (this.cloudStorage.readiness.requested && !this.cloudStorage.readiness.enabled) {
            this.logger.warn(
                `Google Drive desativado: ${this.cloudStorage.readiness.reason || 'credenciais OAuth incompletas'}.`,
            );
        }
        if (this.cloudStorage.readiness.enabled) {
            const initialCloudTimer = setTimeout(() => this.recoverCloudJobs(), 5_000);
            initialCloudTimer.unref();
            this.cloudRecoveryTimer = setInterval(() => this.recoverCloudJobs(), 60_000);
            this.cloudRecoveryTimer.unref();
        }
        if (!this.recordingEnabled) {
            this.logger.warn(
                `Gravacao de cameras desativada${this.recordingRequired ? ' apesar de obrigatoria' : ''}.`,
            );
            return;
        }
        if (this.semanticAnalyzer.readiness.requested && !this.semanticAnalyzer.readiness.enabled) {
            const reason = this.semanticAnalyzer.readiness.reason === 'consent_required'
                ? 'consentimento explicito ausente'
                : 'chave pessoal da API ausente';
            this.logger.warn(`Analise semantica em nuvem desativada: ${reason}.`);
        }
        if (!this.cameraSelection.all && this.cameraSelection.ids.size === 0) {
            this.logger.warn('Gravacao habilitada sem CAMERA_RECORDING_DEVICE_IDS; nenhuma camera sera gravada.');
            return;
        }
        if (!this.requireMount) mkdirSync(this.recordingRoot, { recursive: true });
        const initialTimer = setTimeout(() => {
            this.reconcileWorkers();
            this.recoverPendingSemanticJobs();
        }, 3_000);
        initialTimer.unref();
        this.reconcileTimer = setInterval(() => this.reconcileWorkers(), 30_000);
        this.reconcileTimer.unref();
        this.cleanupTimer = setInterval(() => this.cleanup(), 10_000);
        this.cleanupTimer.unref();
        this.semanticRecoveryTimer = setInterval(() => this.recoverPendingSemanticJobs(), 60_000);
        this.semanticRecoveryTimer.unref();
    }

    onModuleDestroy(): void {
        this.semanticStopped = true;
        if (this.reconcileTimer) clearInterval(this.reconcileTimer);
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        if (this.semanticRecoveryTimer) clearInterval(this.semanticRecoveryTimer);
        if (this.cloudRecoveryTimer) clearInterval(this.cloudRecoveryTimer);
        this.stopAllWorkers();
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
                `SELECT * FROM camera_recordings WHERE device_id = ? ${dateClause} ORDER BY started_at DESC LIMIT 1000`,
                params,
            )
            .map((row) => this.toRecording(row));
    }

    healthSnapshot(now = Date.now()): CameraRecordingHealth {
        if (!this.recordingEnabled) {
            return {
                status: this.recordingRequired ? 'degraded' : 'disabled',
                required: this.recordingRequired,
                enabled: false,
                expectedWorkers: 0,
                activeWorkers: 0,
                healthyWorkers: 0,
                issues: this.recordingRequired ? ['recording_disabled'] : [],
            };
        }

        const expectedWorkers = this.selectedCameras().length;
        let healthyWorkers = 0;
        let lastHeartbeatAt = 0;
        let lastSegmentAt = 0;
        let workerStarting = false;
        for (const worker of this.workers.values()) {
            this.refreshLastSegmentAt(worker);
            lastHeartbeatAt = Math.max(lastHeartbeatAt, worker.lastDetectorHeartbeatAt || 0);
            lastSegmentAt = Math.max(lastSegmentAt, worker.lastSegmentAt || 0);
            const heartbeatHealthy = !this.objectDetectionEnabled
                || Boolean(
                    worker.classifierReady
                    && worker.lastDetectorHeartbeatAt
                    && now - worker.lastDetectorHeartbeatAt <= CAMERA_HEARTBEAT_STALE_MS,
                );
            const segmentHealthy = Boolean(
                worker.lastSegmentAt
                && now - worker.lastSegmentAt <= CAMERA_SEGMENT_STALE_MS,
            );
            if (heartbeatHealthy && segmentHealthy) {
                healthyWorkers += 1;
            } else if (now - worker.startedAt <= CAMERA_WORKER_GRACE_MS) {
                workerStarting = true;
            }
        }

        const issues: string[] = [];
        if (expectedWorkers === 0) issues.push('no_selected_camera_found');
        if (this.workers.size !== expectedWorkers) issues.push('worker_count_mismatch');
        if (healthyWorkers !== expectedWorkers) issues.push('pipeline_stale');
        if (this.activeWarnings.size > 0) issues.push('active_warning');
        const starting = now - this.serviceStartedAt <= CAMERA_WORKER_GRACE_MS || workerStarting;
        const status = issues.length === 0
            ? 'ok'
            : starting && expectedWorkers > 0
                ? 'starting'
                : 'degraded';
        const lastEvent = this.storage.get<{ value: string | null }>(
            'SELECT MAX(created_at) AS value FROM camera_recordings',
        )?.value;

        return {
            status,
            required: this.recordingRequired,
            enabled: true,
            expectedWorkers,
            activeWorkers: this.workers.size,
            healthyWorkers,
            issues,
            ...(lastHeartbeatAt ? { lastHeartbeatAt: new Date(lastHeartbeatAt).toISOString() } : {}),
            ...(lastSegmentAt ? { lastSegmentAt: new Date(lastSegmentAt).toISOString() } : {}),
            ...(lastEvent ? { lastEventAt: lastEvent } : {}),
        };
    }

    async streamFile(
        deviceId: number,
        recordingId: number,
        kind: 'video' | 'thumbnail',
        request: any,
        response: any,
    ): Promise<boolean> {
        const row = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ? AND device_id = ?',
            [recordingId, deviceId],
        );
        const filePath = kind === 'video' ? row?.file_path : row?.thumbnail_path;
        const resolvedFilePath = filePath
            ? resolveRecordingFileInsideRoot(this.recordingRoot, filePath)
            : undefined;
        if (resolvedFilePath) {
            const fileSize = statSync(resolvedFilePath).size;
            const contentType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
            const range = kind === 'video' ? String(request.headers.range || '') : '';
            if (kind === 'video') response.setHeader('Accept-Ranges', 'bytes');
            if (range) {
                const parsedRange = parseCameraRecordingRange(range, fileSize);
                if (!parsedRange) {
                    response.status(416);
                    response.setHeader('Content-Range', `bytes */${fileSize}`);
                    response.end();
                    return true;
                }
                const { start, end } = parsedRange;
                response.status(206);
                response.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                response.setHeader('Content-Length', end - start + 1);
                response.setHeader('Content-Type', contentType);
                createReadStream(resolvedFilePath, { start, end }).pipe(response);
                return true;
            }

            response.status(200);
            response.setHeader('Content-Length', fileSize);
            response.setHeader('Content-Type', contentType);
            response.setHeader('Cache-Control', kind === 'video' ? 'no-store' : 'private, max-age=3600');
            createReadStream(resolvedFilePath).pipe(response);
            return true;
        }

        if (!row || kind !== 'video' || !this.cloudStorage.readiness.enabled) return false;
        const cloud = this.cloudState(this.storage.jsonLoad<JsonObject>(row.metadata_json, {}));
        if (cloud?.status !== 'uploaded' || !cloud.fileId) return false;

        try {
            const range = String(request.headers.range || '').trim() || undefined;
            const upstream = await this.cloudStorage.stream(cloud.fileId, range);
            if (upstream.status === 404) return false;
            if (![200, 206, 416].includes(upstream.status)) {
                response.status(upstream.status === 429 || upstream.status >= 500 ? 503 : 502);
                response.end();
                return true;
            }

            response.status(upstream.status);
            for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
                const value = upstream.headers.get(header);
                if (value) response.setHeader(header, value);
            }
            response.setHeader('Cache-Control', 'no-store');
            if (!upstream.body) {
                response.end();
                return true;
            }
            Readable.fromWeb(upstream.body as any)
                .on('error', () => response.destroy())
                .pipe(response);
            return true;
        } catch (error) {
            this.logger.warn(`Falha ao transmitir gravacao ${recordingId} do Google Drive: ${this.errorMessage(error)}`);
            response.status(503);
            response.end();
            return true;
        }
    }

    private reconcileWorkers(): void {
        try {
            if (!this.recordingPrerequisitesReady()) {
                this.stopAllWorkers();
                return;
            }
            this.enforceRecordingLimits();
            if (!this.hasMinimumFreeSpace()) {
                this.stopAllWorkers();
                return;
            }

            const cameras = this.selectedCameras();
            const cameraIds = new Set(cameras.map((camera) => Number(camera.id)));

            for (const worker of [...this.workers.values()]) {
                if (!cameraIds.has(worker.deviceId)) this.stopWorker(worker);
            }
            for (const camera of cameras) {
                const deviceId = Number(camera.id);
                if (this.workers.has(deviceId)) continue;
                const urls = this.cameraUrls(camera);
                if (urls) {
                    this.startWorker(
                        deviceId,
                        String(camera.name || `Câmera ${deviceId}`),
                        urls.main,
                        urls.low,
                        urls.onvif,
                    );
                }
            }
        } catch (error) {
            this.stopAllWorkers();
            this.logger.error(`Falha ao reconciliar gravadores: ${this.errorMessage(error)}`);
        }
    }

    private selectedCameras(): JsonObject[] {
        return this.storage
            .all<JsonObject>(
                `SELECT id, name, payload_json, capabilities_json, secrets_json
                 FROM devices
                 WHERE provider = 'onvif_camera' AND LOWER(device_type) IN ('camera', 'cam')`,
            )
            .filter((camera) => isCameraRecordingSelected(this.cameraSelection, Number(camera.id)));
    }

    private startWorker(
        deviceId: number,
        cameraName: string,
        mainUrl: string,
        lowUrl: string,
        onvif?: OnvifCameraClient,
    ): void {
        const segmentDirectory = join(this.segmentRoot, String(deviceId));
        mkdirSync(segmentDirectory, { recursive: true });
        const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
        const recorder = spawn(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', mainUrl,
            '-map', '0:v:0', '-an', '-c:v', 'copy',
            '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1', '-strftime', '1',
            join(segmentDirectory, '%Y%m%d-%H%M%S.mkv'),
        ]);
        const detector = spawn(
            ffmpeg,
            this.objectDetectionEnabled
                ? [
                    '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', lowUrl,
                    '-an',
                    '-vf',
                    `fps=${this.objectDetectorFps},scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2`,
                    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
                ]
                : [
                    '-hide_banner', '-loglevel', 'info', '-rtsp_transport', 'tcp', '-i', lowUrl,
                    '-an', '-vf', 'fps=2,scale=320:-2,select=gt(scene\\,0.015),metadata=print',
                    '-f', 'null', '-',
                ],
        );
        const worker: CameraWorker = {
            deviceId,
            cameraName,
            segmentDirectory,
            recorder,
            detector,
            classifierBuffer: '',
            classifierReady: !this.objectDetectionEnabled,
            objectEvidence: new Map(),
            inferenceCount: 0,
            inferenceTotalMs: 0,
            inferenceMaxMs: 0,
            startedAt: Date.now(),
            motionSources: new Set(),
            finalizing: false,
            stopping: false,
            onvif,
        };
        this.workers.set(deviceId, worker);

        recorder.stdout.resume();
        recorder.stderr.resume();
        const failed = (processName: 'recorder' | 'detector' | 'classifier', code?: number | null, signal?: NodeJS.Signals | null) => {
            if (worker.stopping) return;
            this.logger.warn(
                `${processName === 'classifier' ? 'Classificador' : `ffmpeg ${processName}`} da camera ${deviceId} encerrou`
                + ` (codigo=${code ?? 'erro'}, sinal=${signal ?? 'nenhum'}); reiniciando.`,
            );
            this.restartWorker(worker, `${processName}_exited`);
        };
        if (this.objectDetectionEnabled) {
            detector.stderr.resume();
            this.connectObjectClassifier(worker, failed);
        } else {
            detector.stdout.resume();
            detector.stderr.on('data', (chunk: Buffer) => {
                if (chunk.toString().includes('lavfi.scene_score=')) this.markMotion(worker);
            });
        }
        recorder.on('error', () => failed('recorder'));
        detector.on('error', () => failed('detector'));
        recorder.on('exit', (code, signal) => failed('recorder', code, signal));
        detector.on('exit', (code, signal) => failed('detector', code, signal));
        if (onvif) void this.monitorOnvifMotion(worker);
    }

    private stopWorker(worker: CameraWorker): void {
        worker.stopping = true;
        if (worker.finalizeTimer) clearTimeout(worker.finalizeTimer);
        if (worker.classifierReadyTimer) clearTimeout(worker.classifierReadyTimer);
        if (worker.classifier) {
            worker.detector.stdout.unpipe(worker.classifier);
            worker.classifier.destroy();
        }
        if (worker.recorder.pid && !worker.recorder.killed) worker.recorder.kill('SIGTERM');
        if (worker.detector.pid && !worker.detector.killed) worker.detector.kill('SIGTERM');
        this.workers.delete(worker.deviceId);
    }

    private async monitorOnvifMotion(worker: CameraWorker): Promise<void> {
        if (!worker.onvif) return;

        while (!worker.stopping) {
            let subscriptionUrl: string | undefined;
            try {
                subscriptionUrl = await worker.onvif.createMotionPullPoint();
                worker.onvifSubscriptionUrl = subscriptionUrl;
                this.activeWarnings.delete(`onvif-motion:${worker.deviceId}`);

                while (!worker.stopping) {
                    const events = await worker.onvif.pullMotionEvents(subscriptionUrl);
                    if (worker.stopping) break;
                    for (const event of events) {
                        if (!event.active) continue;
                        const now = Date.now();
                        this.markMotionAt(worker, now, now, 'onvif');
                    }
                }
            } catch (error) {
                if (!worker.stopping) {
                    this.warnOnce(
                        `onvif-motion:${worker.deviceId}`,
                        `Alertas ONVIF da camera ${worker.deviceId} indisponiveis; tentando novamente: ${this.errorMessage(error)}`,
                    );
                }
            } finally {
                worker.onvifSubscriptionUrl = undefined;
                if (subscriptionUrl) {
                    await worker.onvif.unsubscribeMotionPullPoint(subscriptionUrl).catch(() => undefined);
                }
            }

            if (!worker.stopping) await this.wait(5_000);
        }
    }

    private wait(milliseconds: number): Promise<void> {
        return new Promise((resolveWait) => {
            const timer = setTimeout(resolveWait, milliseconds);
            timer.unref();
        });
    }

    private restartWorker(worker: CameraWorker, reason: string): void {
        const deviceId = worker.deviceId;
        this.stopWorker(worker);
        this.logger.warn(`Pipeline da camera ${deviceId} reiniciado pelo watchdog (${reason}).`);
        const timer = setTimeout(() => {
            if (this.semanticStopped || this.workers.has(deviceId)) return;
            this.reconcileWorkers();
        }, 1_000);
        timer.unref();
    }

    private connectObjectClassifier(
        worker: CameraWorker,
        failed: (processName: 'classifier', code?: number | null, signal?: NodeJS.Signals | null) => void,
    ): void {
        const classifier = createConnection(this.cameraAiSocket);
        worker.classifier = classifier;
        worker.classifierReadyTimer = setTimeout(() => {
            if (!worker.classifierReady) failed('classifier');
        }, 10_000);
        worker.classifierReadyTimer.unref();

        classifier.on('connect', () => {
            if (!worker.stopping) worker.detector.stdout.pipe(classifier, { end: false });
        });
        classifier.on('data', (chunk: Buffer) => {
            try {
                this.handleClassifierData(worker, chunk);
            } catch (error) {
                this.logger.warn(
                    `Resposta invalida do classificador da camera ${worker.deviceId}: ${this.errorMessage(error)}`,
                );
                failed('classifier');
            }
        });
        classifier.on('error', () => failed('classifier'));
        classifier.on('close', () => failed('classifier'));
    }

    private handleClassifierData(worker: CameraWorker, chunk: Buffer): void {
        worker.classifierBuffer += chunk.toString('utf8');
        if (worker.classifierBuffer.length > 65_536) {
            throw new Error('buffer de resposta excedeu o limite');
        }

        const lines = worker.classifierBuffer.split('\n');
        worker.classifierBuffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            const payload = JSON.parse(line) as JsonObject;
            if (payload.type === 'ready') {
                if (
                    payload.modelSha256 !== OBJECT_DETECTOR_MODEL_SHA256
                    || Number(payload.width) !== 320
                    || Number(payload.height) !== 320
                ) {
                    throw new Error('modelo ou dimensoes inesperados');
                }
                worker.classifierReady = true;
                worker.lastDetectorHeartbeatAt = Date.now();
                if (worker.classifierReadyTimer) clearTimeout(worker.classifierReadyTimer);
                worker.classifierReadyTimer = undefined;
                continue;
            }
            if (payload.type === 'heartbeat' && worker.classifierReady) {
                worker.lastDetectorHeartbeatAt = Date.now();
                this.activeWarnings.delete(`heartbeat:${worker.deviceId}`);
                continue;
            }
            if (payload.type !== 'object_motion' || !worker.classifierReady) continue;
            worker.lastDetectorHeartbeatAt = Date.now();
            this.markObjectMotion(worker, payload);
        }
    }

    private markMotion(worker: CameraWorker): void {
        const now = Date.now();
        this.markMotionAt(worker, now, now, 'scene');
    }

    private markObjectMotion(worker: CameraWorker, payload: JsonObject): void {
        const now = Date.now();
        const observedAt = Number(payload.observedAtMs);
        const safeObservedAt = Number.isFinite(observedAt) && Math.abs(now - observedAt) <= 30_000
            ? observedAt
            : now;
        const objects = Array.isArray(payload.objects) ? payload.objects : [];
        let firstSeenAt = safeObservedAt;
        let validObjects = 0;

        for (const value of objects) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const item = value as JsonObject;
            const label = String(item.label || '').trim();
            const score = Number(item.score);
            const displacement = Number(item.displacement);
            const rawTrackId = Number(item.trackId);
            const trackId = Number.isSafeInteger(rawTrackId) && rawTrackId > 0
                ? rawTrackId
                : undefined;
            const rawFirstSeenAt = Number(item.firstSeenAtMs);
            const safeFirstSeenAt = Number.isFinite(rawFirstSeenAt)
                && rawFirstSeenAt <= safeObservedAt
                && safeObservedAt - rawFirstSeenAt <= 30_000
                ? rawFirstSeenAt
                : safeObservedAt;
            if (!label || !Number.isFinite(score) || score < 0 || score > 1) continue;

            validObjects += 1;
            firstSeenAt = Math.min(firstSeenAt, safeFirstSeenAt);
            const evidenceKey = trackId ? `track:${trackId}` : `label:${label}`;
            const existing = worker.objectEvidence.get(evidenceKey);
            const color = parseObjectColor(item.color);
            const trajectory = parseObjectTrajectory(item.trajectory);
            worker.objectEvidence.set(evidenceKey, {
                ...(trackId ? { trackId } : {}),
                label: !existing || score >= existing.maxScore ? label : existing.label,
                maxScore: Math.max(existing?.maxScore || 0, score),
                firstSeenAt: Math.min(existing?.firstSeenAt || safeFirstSeenAt, safeFirstSeenAt),
                lastSeenAt: Math.max(existing?.lastSeenAt || safeObservedAt, safeObservedAt),
                maxDisplacement: Math.max(
                    existing?.maxDisplacement || 0,
                    Number.isFinite(displacement) ? displacement : 0,
                ),
                ...(color && (!existing?.color || color.samples >= existing.color.samples)
                    ? { color }
                    : existing?.color
                        ? { color: existing.color }
                        : {}),
                ...(trajectory
                    ? { trajectory }
                    : existing?.trajectory
                        ? { trajectory: existing.trajectory }
                        : {}),
            });
        }
        if (!validObjects) return;

        const inferenceMs = Number(payload.inferenceMs);
        if (Number.isFinite(inferenceMs) && inferenceMs >= 0 && inferenceMs <= 60_000) {
            worker.inferenceCount += 1;
            worker.inferenceTotalMs += inferenceMs;
            worker.inferenceMaxMs = Math.max(worker.inferenceMaxMs, inferenceMs);
        }
        this.markMotionAt(worker, firstSeenAt, safeObservedAt, 'object');
    }

    private markMotionAt(
        worker: CameraWorker,
        startedAt: number,
        observedAt: number,
        source: CameraMotionSource,
    ): void {
        worker.motionSources.add(source);
        worker.motionStartedAt ??= startedAt;
        worker.lastMotionAt = Math.max(worker.lastMotionAt || observedAt, observedAt);
        if (worker.finalizeTimer) clearTimeout(worker.finalizeTimer);
        worker.finalizeTimer = setTimeout(
            () => void this.finalizeMotionEvent(worker),
            (POST_ROLL_SECONDS + SEGMENT_SECONDS + 1) * 1_000,
        );
        worker.finalizeTimer.unref();
    }

    private async finalizeMotionEvent(worker: CameraWorker): Promise<void> {
        worker.finalizeTimer = undefined;
        if (worker.stopping) return;
        if (worker.finalizing) {
            worker.finalizeTimer = setTimeout(() => void this.finalizeMotionEvent(worker), 1_000);
            worker.finalizeTimer.unref();
            return;
        }

        worker.finalizing = true;
        const motionStartedAt = worker.motionStartedAt;
        const lastMotionAt = worker.lastMotionAt;
        const startedAt = motionStartedAt ? motionStartedAt - PRE_ROLL_SECONDS * 1_000 : 0;
        worker.retainedSince = startedAt;
        worker.motionStartedAt = undefined;
        worker.lastMotionAt = undefined;
        const objectEvidence = [...worker.objectEvidence.values()];
        worker.objectEvidence.clear();
        const motionSources = [...worker.motionSources];
        worker.motionSources.clear();
        const semantic = buildCameraEventSemantic(objectEvidence, worker.cameraName);
        const inferenceCount = worker.inferenceCount;
        const inferenceAverageMs = inferenceCount
            ? worker.inferenceTotalMs / inferenceCount
            : 0;
        const inferenceMaxMs = worker.inferenceMaxMs;
        worker.inferenceCount = 0;
        worker.inferenceTotalMs = 0;
        worker.inferenceMaxMs = 0;
        if (!motionStartedAt || !lastMotionAt) {
            worker.finalizing = false;
            worker.retainedSince = undefined;
            return;
        }
        if (!shouldPersistCameraMotion(this.objectDetectionEnabled, semantic, motionSources)) {
            worker.finalizing = false;
            worker.retainedSince = undefined;
            return;
        }

        let concatPath: string | undefined;
        let temporaryVideoPath: string | undefined;
        let videoPath: string | undefined;
        let thumbnailPath: string | undefined;
        let recordingPersisted = false;
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
            videoPath = join(eventDirectory, `${eventName}.mp4`);
            temporaryVideoPath = join(eventDirectory, `${eventName}.partial.mp4`);
            thumbnailPath = join(eventDirectory, `${eventName}.jpg`);
            concatPath = join(eventDirectory, `${eventName}.txt`);
            writeFileSync(concatPath, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));

            let copied = false;
            try {
                copied = await this.runFfmpeg([
                    '-hide_banner', '-loglevel', 'error',
                    '-f', 'concat', '-safe', '0', '-i', concatPath,
                    '-an',
                    '-vf', 'scale=-2:720',
                    '-c:v', 'libx264',
                    '-threads', '1',
                    '-preset', 'ultrafast',
                    '-crf', '25',
                    '-pix_fmt', 'yuv420p',
                    '-profile:v', 'main',
                    '-level:v', '3.1',
                    '-movflags', '+faststart',
                    temporaryVideoPath,
                ]);
            } finally {
                rmSync(concatPath, { force: true });
            }
            if (!copied || !existsSync(temporaryVideoPath)) {
                rmSync(temporaryVideoPath, { force: true });
                return;
            }
            renameSync(temporaryVideoPath, videoPath);
            await this.runFfmpeg([
                '-hide_banner',
                '-loglevel',
                'error',
                '-ss',
                String(PRE_ROLL_SECONDS + SEGMENT_SECONDS),
                '-i',
                videoPath,
                '-frames:v',
                '1',
                '-q:v',
                '3',
                thumbnailPath,
            ]);

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
                    this.storage.jsonDump(
                        this.objectDetectionEnabled
                            ? {
                                schemaVersion: 2,
                                detector: 'litert-efficientdet-lite0-int8',
                                modelSha256: OBJECT_DETECTOR_MODEL_SHA256,
                                classificationStatus: this.semanticAnalyzer.readiness.enabled
                                    ? 'semantic_pending'
                                    : 'local_unconfirmed',
                                description: this.semanticAnalyzer.readiness.enabled
                                    ? SEMANTIC_PENDING_DESCRIPTION
                                    : LOCAL_UNCONFIRMED_DESCRIPTION,
                                objects: objectEvidence,
                                semantic,
                                inference: {
                                    samples: inferenceCount,
                                    averageMs: Math.round(inferenceAverageMs * 100) / 100,
                                    maxMs: Math.round(inferenceMaxMs * 100) / 100,
                                },
                                policy: {
                                    confirmationFrames: 2,
                                    confirmationWindowSeconds: 3.5,
                                    minimumScore: this.objectMinimumScore,
                                    ignoresStaticObjects: true,
                                },
                                triggerSources: motionSources,
                                preRollSeconds: PRE_ROLL_SECONDS,
                                postRollSeconds: POST_ROLL_SECONDS,
                                ...(this.cloudStorage.readiness.enabled
                                    ? {
                                        cloudStorage: {
                                            provider: 'google_drive',
                                            status: 'pending',
                                            attempts: 0,
                                        },
                                    }
                                    : {}),
                            }
                            : {
                                detector: 'local-frame-change',
                                triggerSources: motionSources,
                                preRollSeconds: PRE_ROLL_SECONDS,
                                postRollSeconds: POST_ROLL_SECONDS,
                                ...(this.cloudStorage.readiness.enabled
                                    ? {
                                        cloudStorage: {
                                            provider: 'google_drive',
                                            status: 'pending',
                                            attempts: 0,
                                        },
                                    }
                                    : {}),
                            },
                    ),
                    createdAt,
                ],
            );
            const recordingId = Number(result.lastInsertRowid);
            recordingPersisted = true;
            const pendingSemantic = this.semanticAnalyzer.readiness.enabled;
            const eventDescription = pendingSemantic
                ? SEMANTIC_PENDING_DESCRIPTION
                : LOCAL_UNCONFIRMED_DESCRIPTION;
            const eventResult = this.storage.run(
                `INSERT INTO device_events (device_id, event_type, title, message, level, payload_json, created_at)
                 VALUES (?, 'camera_motion_recorded', 'Evento gravado', ?, 'info', ?, ?)`,
                [
                    worker.deviceId,
                    eventDescription,
                    this.storage.jsonDump(pendingSemantic
                        ? {
                            schemaVersion: 3,
                            recordingId,
                            description: eventDescription,
                            analysisStatus: 'pending',
                            localSemantic: semantic,
                        }
                        : {
                            schemaVersion: 3,
                            recordingId,
                            description: eventDescription,
                            analysisStatus: 'unconfirmed',
                            localSemantic: semantic,
                        }),
                    createdAt,
                ],
            );
            const eventId = Number(eventResult.lastInsertRowid);
            if (this.semanticAnalyzer.readiness.enabled && videoPath) {
                this.markSemanticPending(recordingId, eventId, worker.cameraName);
                this.enqueueSemanticAnalysis({
                    deviceId: worker.deviceId,
                    eventId,
                    recordingId,
                    videoPath,
                    cameraName: worker.cameraName,
                });
            }
            if (this.cloudStorage.readiness.enabled) this.enqueueCloudUpload(recordingId);
        } catch (error) {
            for (const artifact of [concatPath, temporaryVideoPath]) {
                if (artifact) rmSync(artifact, { force: true });
            }
            if (!recordingPersisted) {
                for (const artifact of [videoPath, thumbnailPath]) {
                    if (artifact) rmSync(artifact, { force: true });
                }
            }
            this.logger.error(`Falha ao finalizar evento da camera ${worker.deviceId}: ${this.errorMessage(error)}`);
        } finally {
            worker.finalizing = false;
            worker.retainedSince = undefined;
            if (!worker.stopping && worker.motionStartedAt && !worker.finalizeTimer) {
                worker.finalizeTimer = setTimeout(() => void this.finalizeMotionEvent(worker), 1_000);
                worker.finalizeTimer.unref();
            }
        }
    }

    private cleanup(): void {
        try {
            if (!this.recordingStorageReady()) {
                this.stopAllWorkers();
                return;
            }
            this.cleanupIncompleteArtifacts();
            this.enforceRecordingLimits();
            if (!this.hasMinimumFreeSpace()) this.stopAllWorkers();

            for (const worker of [...this.workers.values()]) {
                this.refreshLastSegmentAt(worker);
                if (Date.now() - worker.startedAt > CAMERA_WORKER_GRACE_MS) {
                    const heartbeatStale = this.objectDetectionEnabled
                        && (
                            !worker.lastDetectorHeartbeatAt
                            || Date.now() - worker.lastDetectorHeartbeatAt > CAMERA_HEARTBEAT_STALE_MS
                        );
                    const segmentStale = !worker.lastSegmentAt
                        || Date.now() - worker.lastSegmentAt > CAMERA_SEGMENT_STALE_MS;
                    if (heartbeatStale || segmentStale) {
                        this.restartWorker(
                            worker,
                            heartbeatStale ? 'detector_stale' : 'segments_stale',
                        );
                        continue;
                    }
                }
                const activeSince = worker.motionStartedAt ? worker.motionStartedAt - PRE_ROLL_SECONDS * 1_000 : undefined;
                const keepAfter = Math.min(
                    activeSince ?? Number.POSITIVE_INFINITY,
                    worker.retainedSince ?? Number.POSITIVE_INFINITY,
                    Date.now() - this.ringBufferMs,
                );
                for (const file of this.segmentFiles(worker.segmentDirectory)) {
                    if (statSync(file).mtimeMs < keepAfter) rmSync(file, { force: true });
                }
            }
        } catch (error) {
            this.stopAllWorkers();
            this.logger.error(`Falha na limpeza de gravacoes: ${this.errorMessage(error)}`);
        }
    }

    private refreshLastSegmentAt(worker: CameraWorker): void {
        try {
            for (const file of this.segmentFiles(worker.segmentDirectory)) {
                const stats = statSync(file);
                if (stats.size > 0) {
                    worker.lastSegmentAt = Math.max(worker.lastSegmentAt || 0, stats.mtimeMs);
                }
            }
        } catch {
            // A rotacao do ffmpeg pode remover ou renomear um segmento entre listagem e stat.
        }
    }

    private cleanupIncompleteArtifacts(): void {
        const now = Date.now();
        if (now - this.lastIncompleteArtifactCleanupAt < 60 * 60_000) return;
        this.lastIncompleteArtifactCleanupAt = now;
        const staleBefore = now - 60 * 60_000;
        const paths = readdirSync(this.recordingRoot, {
            recursive: true,
            encoding: 'utf8',
        }) as string[];
        for (const path of paths) {
            if (!path.endsWith('.partial.mp4') && !path.endsWith('.txt')) continue;
            const filePath = join(this.recordingRoot, path);
            if (!isPathInsideRecordingRoot(this.recordingRoot, filePath)) continue;
            try {
                const stats = statSync(filePath);
                if (stats.isFile() && stats.mtimeMs < staleBefore) rmSync(filePath, { force: true });
            } catch {
                // The worker may have completed or removed the artifact meanwhile.
            }
        }
    }

    private recoverCloudJobs(): void {
        if (!this.cloudStorage.readiness.enabled) return;
        const now = Date.now();
        const retentionLimit = now - this.cloudRetentionDays * 86_400_000;
        const recordings = this.storage.all<CameraRecordingRow>(
            `SELECT * FROM camera_recordings
             WHERE metadata_json LIKE '%"provider":"google_drive"%'
             ORDER BY ended_at ASC, id ASC`,
        );

        for (const recording of recordings) {
            const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
            const cloud = this.cloudState(metadata);
            if (!cloud) continue;
            const nextAttemptAt = Date.parse(String(cloud.nextAttemptAt || ''));
            if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now) continue;

            if (cloud.status === 'uploaded') {
                const endedAt = Date.parse(recording.ended_at);
                if (Number.isFinite(endedAt) && endedAt < retentionLimit) {
                    this.enqueueCloudDelete(recording.id);
                } else {
                    this.releaseUploadedVideo(recording);
                }
                continue;
            }
            if (cloud.status === 'deleting') {
                this.enqueueCloudDelete(recording.id);
                continue;
            }
            this.enqueueCloudUpload(recording.id);
        }
    }

    private enqueueCloudUpload(recordingId: number): void {
        if (!this.cloudStorage.readiness.enabled || this.cloudQueuedRecordingIds.has(recordingId)) return;
        this.cloudQueuedRecordingIds.add(recordingId);
        this.cloudQueue = this.cloudQueue
            .then(() => this.uploadCloudRecording(recordingId))
            .catch((error) => {
                this.logger.error(
                    `Fila do Google Drive falhou para a gravacao ${recordingId}: ${this.errorMessage(error)}`,
                );
            })
            .finally(() => this.cloudQueuedRecordingIds.delete(recordingId));
    }

    private enqueueCloudDelete(recordingId: number): void {
        if (!this.cloudStorage.readiness.enabled || this.cloudQueuedRecordingIds.has(recordingId)) return;
        this.cloudQueuedRecordingIds.add(recordingId);
        this.cloudQueue = this.cloudQueue
            .then(() => this.deleteCloudRecording(recordingId))
            .catch((error) => {
                this.logger.error(
                    `Exclusao no Google Drive falhou para a gravacao ${recordingId}: ${this.errorMessage(error)}`,
                );
            })
            .finally(() => this.cloudQueuedRecordingIds.delete(recordingId));
    }

    private async uploadCloudRecording(recordingId: number): Promise<void> {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const cloud = this.cloudState(metadata);
        if (!cloud || ['uploaded', 'deleting'].includes(cloud.status)) return;

        const videoPath = resolveRecordingFileInsideRoot(this.recordingRoot, recording.file_path);
        if (!videoPath) {
            this.markCloudFailure(recordingId, 'local_video_missing');
            return;
        }

        const attempts = Math.max(0, Number(cloud.attempts) || 0) + 1;
        this.updateCloudState(recordingId, {
            ...cloud,
            status: 'uploading',
            attempts,
            nextAttemptAt: undefined,
            lastError: undefined,
        });
        try {
            const uploaded = await this.cloudStorage.upload(videoPath, {
                recordingId,
                deviceId: recording.device_id,
                startedAt: recording.started_at,
            });
            const latest = this.storage.get<CameraRecordingRow>(
                'SELECT * FROM camera_recordings WHERE id = ?',
                [recordingId],
            );
            if (!latest) return;
            const latestMetadata = this.storage.jsonLoad<JsonObject>(latest.metadata_json, {});
            const latestCloud = this.cloudState(latestMetadata) || cloud;
            this.updateCloudState(recordingId, {
                ...latestCloud,
                provider: 'google_drive',
                status: 'uploaded',
                attempts,
                fileId: uploaded.id,
                size: uploaded.size,
                md5Checksum: uploaded.md5Checksum,
                uploadedAt: new Date().toISOString(),
                nextAttemptAt: undefined,
                lastError: undefined,
            });
            this.logger.log(`Gravacao ${recordingId} confirmada no Google Drive.`);
        } catch (error) {
            this.markCloudFailure(recordingId, 'upload_failed');
            this.logger.warn(
                `Upload da gravacao ${recordingId} ao Google Drive falhou; sera repetido: ${this.errorMessage(error)}`,
            );
        }
    }

    private async deleteCloudRecording(recordingId: number): Promise<void> {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const cloud = this.cloudState(metadata);
        if (!cloud?.fileId || !['uploaded', 'deleting'].includes(cloud.status)) return;

        this.updateCloudState(recordingId, {
            ...cloud,
            status: 'deleting',
            nextAttemptAt: undefined,
            lastError: undefined,
        });
        try {
            await this.cloudStorage.delete(cloud.fileId);
            const latest = this.storage.get<CameraRecordingRow>(
                'SELECT * FROM camera_recordings WHERE id = ?',
                [recordingId],
            );
            if (latest) this.deleteRecording(latest, 'cloud_retention');
        } catch (error) {
            this.markCloudFailure(recordingId, 'delete_failed', 'uploaded');
            this.logger.warn(
                `Retencao da gravacao ${recordingId} no Google Drive falhou; sera repetida: ${this.errorMessage(error)}`,
            );
        }
    }

    private markCloudFailure(
        recordingId: number,
        errorCode: string,
        status: CameraCloudState['status'] = 'failed',
    ): void {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const cloud = this.cloudState(metadata);
        if (!cloud) return;
        const attempts = Math.max(1, Number(cloud.attempts) || 1);
        const retryDelay = Math.min(this.cloudRetryMs * (2 ** Math.min(attempts - 1, 6)), 6 * 3_600_000);
        this.updateCloudState(recordingId, {
            ...cloud,
            status,
            attempts,
            nextAttemptAt: new Date(Date.now() + retryDelay).toISOString(),
            lastError: errorCode,
        });
    }

    private releaseUploadedVideo(recording: CameraRecordingRow, force = false): number {
        if (this.semanticQueuedRecordingIds.has(recording.id)) return 0;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const cloud = this.cloudState(metadata);
        if (cloud?.status !== 'uploaded' || !cloud.fileId) return 0;
        const uploadedAt = Date.parse(String(cloud.uploadedAt || ''));
        if (!force && (!Number.isFinite(uploadedAt) || uploadedAt + this.cloudLocalRetentionMs > Date.now())) {
            return 0;
        }
        if (!existsSync(recording.file_path)) return 0;
        if (!isPathInsideRecordingRoot(this.recordingRoot, recording.file_path)) {
            this.logger.warn(`Video fora do diretorio permitido; preservado: ${recording.file_path}`);
            return 0;
        }

        const releasedBytes = statSync(recording.file_path).size;
        rmSync(recording.file_path, { force: true });
        this.updateCloudState(recording.id, {
            ...cloud,
            localVideoReleasedAt: new Date().toISOString(),
        });
        return releasedBytes;
    }

    private updateCloudState(recordingId: number, cloud: CameraCloudState): void {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        this.storage.run(
            'UPDATE camera_recordings SET metadata_json = ? WHERE id = ?',
            [this.storage.jsonDump({ ...metadata, cloudStorage: cloud }), recordingId],
        );
    }

    private cloudState(metadata: JsonObject): CameraCloudState | undefined {
        const value = metadata.cloudStorage;
        if (!value || typeof value !== 'object' || value.provider !== 'google_drive') return undefined;
        if (!['pending', 'uploading', 'uploaded', 'failed', 'deleting'].includes(String(value.status))) {
            return undefined;
        }
        return {
            provider: 'google_drive',
            status: value.status,
            attempts: Math.max(0, Number(value.attempts) || 0),
            ...(typeof value.fileId === 'string' && value.fileId ? { fileId: value.fileId } : {}),
            ...(Number.isFinite(Number(value.size)) ? { size: Number(value.size) } : {}),
            ...(typeof value.md5Checksum === 'string' ? { md5Checksum: value.md5Checksum } : {}),
            ...(typeof value.uploadedAt === 'string' ? { uploadedAt: value.uploadedAt } : {}),
            ...(typeof value.localVideoReleasedAt === 'string'
                ? { localVideoReleasedAt: value.localVideoReleasedAt }
                : {}),
            ...(typeof value.nextAttemptAt === 'string' ? { nextAttemptAt: value.nextAttemptAt } : {}),
            ...(typeof value.lastError === 'string' ? { lastError: value.lastError } : {}),
        };
    }

    private enqueueSemanticAnalysis(job: CameraSemanticJob): void {
        if (this.semanticStopped || this.semanticQueuedRecordingIds.has(job.recordingId)) return;
        if (Date.now() < this.semanticBackoffUntil || this.semanticQueueDepth >= 20) return;
        this.semanticQueuedRecordingIds.add(job.recordingId);
        this.semanticQueueDepth += 1;
        this.semanticQueue = this.semanticQueue
            .catch(() => undefined)
            .then(async () => {
                if (this.semanticStopped) return;
                let temporaryVideoPath: string | undefined;
                try {
                    if (Date.now() < this.semanticBackoffUntil) return;
                    const preparedVideo = await this.prepareSemanticVideo(job);
                    temporaryVideoPath = preparedVideo.temporary ? preparedVideo.videoPath : undefined;
                    const semantic = await this.semanticAnalyzer.analyze(preparedVideo.videoPath, job.cameraName);
                    this.applySemanticAnalysis(job, semantic);
                } catch (error) {
                    const errorCode = this.semanticErrorCode(error);
                    const deferred = this.isTransientSemanticError(errorCode);
                    if (errorCode === 'camera_semantic_http_429') {
                        this.semanticBackoffUntil = Date.now() + this.semanticRetryMs;
                    }
                    this.markSemanticUnavailable(job.recordingId, errorCode, deferred);
                    this.logger.warn(
                        `Analise semantica da gravacao ${job.recordingId} falhou (${errorCode}); `
                        + `${deferred ? 'reanalise agendada' : 'evento mantido sem descricao detalhada'}.`,
                    );
                } finally {
                    if (
                        temporaryVideoPath
                        && isPathInsideRecordingRoot(this.segmentRoot, temporaryVideoPath)
                    ) {
                        rmSync(temporaryVideoPath, { force: true });
                    }
                    this.semanticQueuedRecordingIds.delete(job.recordingId);
                    this.semanticQueueDepth = Math.max(0, this.semanticQueueDepth - 1);
                }
            });
    }

    private async prepareSemanticVideo(
        job: CameraSemanticJob,
    ): Promise<{ videoPath: string; temporary: boolean }> {
        const localVideo = resolveRecordingFileInsideRoot(this.recordingRoot, job.videoPath);
        if (localVideo) return { videoPath: localVideo, temporary: false };

        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ? AND device_id = ?',
            [job.recordingId, job.deviceId],
        );
        if (!recording || recording.file_path !== job.videoPath) {
            throw new Error('camera_semantic_video_missing');
        }
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const cloud = this.cloudState(metadata);
        if (!cloud || cloud.status !== 'uploaded' || !cloud.fileId) {
            throw new Error('camera_semantic_cloud_pending');
        }
        if (!this.cloudStorage.readiness.enabled) {
            throw new Error('camera_semantic_cloud_unavailable');
        }

        mkdirSync(this.segmentRoot, { recursive: true });
        const temporaryVideoPath = join(
            this.segmentRoot,
            `.semantic-${job.recordingId}-${process.pid}-${Date.now()}.mp4`,
        );
        await this.cloudStorage.download(cloud.fileId, temporaryVideoPath, {
            size: cloud.size,
            md5Checksum: cloud.md5Checksum,
        });
        return { videoPath: temporaryVideoPath, temporary: true };
    }

    private markSemanticPending(recordingId: number, eventId: number, cameraName: string): void {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        this.storage.run(
            'UPDATE camera_recordings SET metadata_json = ? WHERE id = ?',
            [
                this.storage.jsonDump({
                    ...metadata,
                    classificationStatus: 'semantic_pending',
                    semanticJob: {
                        status: 'pending',
                        eventId,
                        cameraName,
                        queuedAt: this.storage.utcNow(),
                    },
                }),
                recordingId,
            ],
        );
    }

    private recoverPendingSemanticJobs(): void {
        if (!this.semanticAnalyzer.readiness.enabled || this.semanticStopped) return;
        if (Date.now() < this.semanticBackoffUntil || this.semanticQueueDepth >= 20) return;
        const pending = this.storage.all<CameraRecordingRow>(
            `SELECT * FROM camera_recordings
             WHERE metadata_json LIKE '%"classificationStatus":"semantic_pending"%'
                OR metadata_json LIKE '%"classificationStatus":"semantic_deferred"%'
             ORDER BY id ASC
             LIMIT 5000`,
        );
        const now = Date.now();
        let availableSlots = 20 - this.semanticQueueDepth;
        for (const recording of pending) {
            if (availableSlots <= 0) break;
            const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
            const semanticJob = metadata.semanticJob && typeof metadata.semanticJob === 'object'
                ? metadata.semanticJob as JsonObject
                : {};
            const retryAfter = Date.parse(String(semanticJob.nextAttemptAt || semanticJob.retryAfter || ''));
            if (Number.isFinite(retryAfter) && retryAfter > now) continue;
            const eventId = Number(semanticJob.eventId);
            const cameraName = String(semanticJob.cameraName || '').trim();
            if (!Number.isSafeInteger(eventId) || eventId <= 0 || !cameraName) {
                this.markSemanticUnavailable(recording.id, 'camera_semantic_job_invalid', false);
                continue;
            }
            this.enqueueSemanticAnalysis({
                deviceId: recording.device_id,
                eventId,
                recordingId: recording.id,
                videoPath: recording.file_path,
                cameraName,
            });
            availableSlots -= 1;
        }
    }

    private applySemanticAnalysis(job: CameraSemanticJob, semantic: CameraVideoSemantic): void {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ? AND device_id = ?',
            [job.recordingId, job.deviceId],
        );
        if (!recording || recording.file_path !== job.videoPath) return;

        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const localSemantic = metadata.semantic;
        const analyzedAt = this.storage.utcNow();
        const updatedMetadata = {
            ...metadata,
            schemaVersion: 3,
            classificationStatus: semantic.eventRelevant ? 'semantic_confirmed' : 'semantic_not_relevant',
            description: semantic.description,
            ...(localSemantic ? { localSemantic } : {}),
            semantic,
            semanticAnalysis: {
                provider: 'google-gemini',
                model: semantic.analyzer.model,
                fps: semantic.analyzer.fps,
                analyzedAt,
            },
            semanticJob: {
                ...(metadata.semanticJob && typeof metadata.semanticJob === 'object'
                    ? metadata.semanticJob
                    : {}),
                status: 'complete',
                completedAt: analyzedAt,
                errorCode: undefined,
                retryAfter: undefined,
                nextAttemptAt: undefined,
            },
        };
        const presentation = this.semanticEventPresentation(semantic);
        this.storage.run(
            'UPDATE camera_recordings SET metadata_json = ? WHERE id = ? AND device_id = ?',
            [this.storage.jsonDump(updatedMetadata), job.recordingId, job.deviceId],
        );
        this.storage.run(
            `UPDATE device_events
             SET title = ?, message = ?, level = ?, payload_json = ?
             WHERE id = ? AND device_id = ?`,
            [
                presentation.title,
                semantic.description,
                presentation.level,
                this.storage.jsonDump({
                    schemaVersion: 3,
                    recordingId: job.recordingId,
                    description: semantic.description,
                    facts: semantic.facts,
                    observations: semantic.observations,
                    risk: semantic.risk,
                    securitySignals: semantic.securitySignals,
                    semantic,
                }),
                job.eventId,
                job.deviceId,
            ],
        );
    }

    private markSemanticUnavailable(recordingId: number, errorCode: string, deferred: boolean): void {
        const recording = this.storage.get<CameraRecordingRow>(
            'SELECT * FROM camera_recordings WHERE id = ?',
            [recordingId],
        );
        if (!recording) return;
        const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
        const semanticJob = metadata.semanticJob && typeof metadata.semanticJob === 'object'
            ? metadata.semanticJob as JsonObject
            : {};
        const description = deferred ? SEMANTIC_DEFERRED_DESCRIPTION : SEMANTIC_FAILED_DESCRIPTION;
        const analyzedAt = this.storage.utcNow();
        const attempts = Math.max(0, Number(semanticJob.attempts) || 0) + 1;
        const retryAfter = deferred
            ? new Date(Date.now() + cameraSemanticRetryDelayMs(this.semanticRetryMs, attempts)).toISOString()
            : undefined;
        this.storage.run(
            'UPDATE camera_recordings SET metadata_json = ? WHERE id = ?',
            [
                this.storage.jsonDump({
                    ...metadata,
                    classificationStatus: deferred ? 'semantic_deferred' : 'semantic_failed',
                    description,
                    semanticAnalysis: {
                        provider: 'google-gemini',
                        status: deferred ? 'deferred' : 'failed',
                        errorCode,
                        analyzedAt,
                    },
                    semanticJob: {
                        ...semanticJob,
                        status: deferred ? 'deferred' : 'dead_letter',
                        errorCode,
                        attempts,
                        lastAttemptAt: analyzedAt,
                        ...(retryAfter ? { retryAfter, nextAttemptAt: retryAfter } : {}),
                    },
                }),
                recordingId,
            ],
        );

        const eventId = Number(semanticJob.eventId);
        if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
        this.storage.run(
            `UPDATE device_events
             SET title = 'Evento gravado', message = ?, level = 'info', payload_json = ?
             WHERE id = ? AND device_id = ?`,
            [
                description,
                this.storage.jsonDump({
                    schemaVersion: 3,
                    recordingId,
                    description,
                    analysisStatus: deferred ? 'deferred' : 'failed',
                    errorCode,
                    ...(retryAfter ? { retryAfter } : {}),
                }),
                eventId,
                recording.device_id,
            ],
        );
    }

    private semanticEventPresentation(
        semantic: CameraVideoSemantic,
    ): { title: string; level: 'info' | 'warning' | 'error' } {
        if (semantic.risk.level === 'critical') return { title: 'Alerta crítico da câmera', level: 'error' };
        if (['medium', 'high'].includes(semantic.risk.level)) {
            return { title: 'Evento que merece atenção', level: 'warning' };
        }
        return { title: 'Evento gravado', level: 'info' };
    }

    private semanticErrorCode(error: unknown): string {
        const message = error instanceof Error ? error.message : '';
        return /^camera_semantic_[a-z0-9_]+$/.test(message)
            ? message
            : 'camera_semantic_unavailable';
    }

    private isTransientSemanticError(errorCode: string): boolean {
        return [
            'camera_semantic_queue_full',
            'camera_semantic_timeout',
            'camera_semantic_network_error',
            'camera_semantic_http_408',
            'camera_semantic_http_429',
            'camera_semantic_http_500',
            'camera_semantic_http_502',
            'camera_semantic_http_503',
            'camera_semantic_http_504',
            'camera_semantic_cloud_pending',
            'camera_semantic_cloud_unavailable',
        ].includes(errorCode);
    }

    private recordingPrerequisitesReady(): boolean {
        return this.recordingStorageReady()
            && this.ffmpegReady()
            && this.objectDetectorReady();
    }

    private objectDetectorReady(): boolean {
        if (!this.objectDetectionEnabled) return true;
        try {
            if (existsSync(this.cameraAiSocket) && statSync(this.cameraAiSocket).isSocket()) {
                this.activeWarnings.delete('camera-ai');
                return true;
            }
        } catch {
            // The sidecar may be restarting; recording remains safely paused.
        }
        this.warnOnce(
            'camera-ai',
            'IA de cameras indisponivel; gravacao pausada para nao salvar falsos movimentos.',
        );
        return false;
    }

    private recordingStorageReady(): boolean {
        if (!existsSync(this.recordingRoot)) {
            if (this.requireMount) {
                this.warnOnce('storage', `HD de gravacao ausente em ${this.recordingRoot}; gravacao pausada.`);
                return false;
            }
            mkdirSync(this.recordingRoot, { recursive: true });
        }
        if (!existsSync(this.segmentRoot)) mkdirSync(this.segmentRoot, { recursive: true });

        if (this.requireMount && statSync(this.recordingRoot).dev === statSync(dirname(this.recordingRoot)).dev) {
            this.warnOnce('storage', `O caminho ${this.recordingRoot} nao e um ponto de montagem; gravacao pausada.`);
            return false;
        }
        try {
            accessSync(this.recordingRoot, fsConstants.R_OK | fsConstants.W_OK);
            accessSync(this.segmentRoot, fsConstants.R_OK | fsConstants.W_OK);
        } catch {
            this.warnOnce(
                'storage',
                `Sem permissao de escrita em ${this.recordingRoot} ou ${this.segmentRoot}; gravacao pausada.`,
            );
            return false;
        }
        this.activeWarnings.delete('storage');
        return true;
    }

    private ffmpegReady(): boolean {
        const now = Date.now();
        if (now - this.lastFfmpegCheckAt < 60_000) return this.ffmpegAvailable;
        this.lastFfmpegCheckAt = now;
        const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], {
            stdio: 'ignore',
            timeout: 15_000,
        });
        this.ffmpegAvailable = result.status === 0;
        if (!this.ffmpegAvailable) {
            this.warnOnce('ffmpeg', 'ffmpeg indisponivel; gravacao pausada sem afetar o Mini-HAS.');
        } else {
            this.activeWarnings.delete('ffmpeg');
        }
        return this.ffmpegAvailable;
    }

    private enforceRecordingLimits(): void {
        const recordings = this.storage.all<CameraRecordingRow>(
            'SELECT * FROM camera_recordings ORDER BY ended_at ASC, id ASC',
        );
        let totalBytes = recordings.reduce((total, recording) => total + this.recordingSize(recording), 0);
        let freeBytes = this.freeBytes();
        const retentionLimit = Date.now() - this.retentionDays * 86_400_000;
        const cloudRetentionLimit = Date.now() - this.cloudRetentionDays * 86_400_000;

        for (const recording of recordings) {
            const endedAt = Date.parse(recording.ended_at);
            const expired = Number.isFinite(endedAt) && endedAt < retentionLimit;
            const metadata = this.storage.jsonLoad<JsonObject>(recording.metadata_json, {});
            const cloud = this.cloudState(metadata);
            if (cloud) {
                if (
                    this.cloudStorage.readiness.enabled
                    && cloud.status === 'uploaded'
                    && Number.isFinite(endedAt)
                    && endedAt < cloudRetentionLimit
                ) {
                    this.enqueueCloudDelete(recording.id);
                    continue;
                }
                if (
                    this.cloudStorage.readiness.enabled
                    && (totalBytes > this.maxStorageBytes || freeBytes < this.minimumFreeBytes)
                ) {
                    const releasedBytes = this.releaseUploadedVideo(recording, true);
                    totalBytes = Math.max(0, totalBytes - releasedBytes);
                    freeBytes += releasedBytes;
                }
                continue;
            }
            if (!expired && totalBytes <= this.maxStorageBytes && freeBytes >= this.minimumFreeBytes) continue;

            const releasedBytes = this.deleteRecording(
                recording,
                expired ? 'local_retention' : 'storage_pressure',
            );
            totalBytes = Math.max(0, totalBytes - releasedBytes);
            freeBytes += releasedBytes;
        }
    }

    private hasMinimumFreeSpace(): boolean {
        const available = this.freeBytes();
        if (available < this.minimumFreeBytes) {
            this.warnOnce(
                'space',
                `Menos de ${Math.round(this.minimumFreeBytes / GIBIBYTE)} GB livres no armazenamento local; gravacao pausada.`,
            );
            return false;
        }
        this.activeWarnings.delete('space');
        return true;
    }

    private freeBytes(): number {
        const stats = statfsSync(this.recordingRoot);
        return Number(stats.bavail) * Number(stats.bsize);
    }

    private recordingSize(recording: CameraRecordingRow): number {
        return [recording.file_path, recording.thumbnail_path]
            .filter((filePath): filePath is string => Boolean(filePath))
            .reduce((total, filePath) => {
                if (!isPathInsideRecordingRoot(this.recordingRoot, filePath) || !existsSync(filePath)) return total;
                return total + statSync(filePath).size;
            }, 0);
    }

    private deleteRecording(
        recording: CameraRecordingRow,
        reason: 'cloud_retention' | 'local_retention' | 'storage_pressure',
    ): number {
        const releasedBytes = this.recordingSize(recording);
        this.logger.warn(
            `Excluindo gravacao ${recording.id}; motivo=${reason}; endedAt=${recording.ended_at}; bytes=${releasedBytes}.`,
        );
        for (const filePath of [recording.file_path, recording.thumbnail_path]) {
            if (!filePath || !existsSync(filePath)) continue;
            if (!isPathInsideRecordingRoot(this.recordingRoot, filePath)) {
                this.logger.warn(`Arquivo de gravacao fora do diretorio permitido; preservado: ${filePath}`);
                continue;
            }
            rmSync(filePath, { force: true });
        }
        this.storage.run('DELETE FROM camera_recordings WHERE id = ?', [recording.id]);
        return releasedBytes;
    }

    private stopAllWorkers(): void {
        for (const worker of [...this.workers.values()]) this.stopWorker(worker);
    }

    private warnOnce(key: string, message: string): void {
        if (this.activeWarnings.has(key)) return;
        this.activeWarnings.add(key);
        this.logger.warn(message);
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private cameraUrls(
        camera: JsonObject,
    ): { main: string; low: string; onvif?: OnvifCameraClient } | null {
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
        const username = String(secrets.username || '');
        const password = String(secrets.password || '');
        const onvif = this.onvifMotionEnabled && username && password
            ? new OnvifCameraClient(ip, port, username, password, path)
            : undefined;
        return { main: main.toString(), low: low.toString(), onvif };
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
        const metadata = this.storage.jsonLoad<JsonObject>(row.metadata_json, {});
        const cloud = this.cloudState(metadata);
        const publicMetadata = cloud
            ? {
                ...metadata,
                cloudStorage: {
                    provider: cloud.provider,
                    status: cloud.status,
                    uploadedAt: cloud.uploadedAt,
                    localVideoAvailable: existsSync(row.file_path),
                },
            }
            : metadata;
        return {
            id: row.id,
            deviceId: row.device_id,
            eventType: row.event_type,
            startedAt: row.started_at,
            motionStartedAt: row.motion_started_at,
            endedAt: row.ended_at,
            durationSeconds: row.duration_seconds,
            hasThumbnail: Boolean(row.thumbnail_path && existsSync(row.thumbnail_path)),
            metadata: publicMetadata,
        };
    }
}
