import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

type FetchInit = RequestInit & { duplex?: 'half' };
type FetchLike = (input: string | URL | Request, init?: FetchInit) => Promise<Response>;

export type GoogleDriveStorageConfig = {
    provider: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    folderId?: string;
    folderName: string;
};

export type GoogleDriveUploadRequest = {
    recordingId: number;
    deviceId: number;
    startedAt: string;
};

export type GoogleDriveFile = {
    id: string;
    name: string;
    size: number;
    md5Checksum: string;
    createdTime?: string;
};

type DriveFilePayload = {
    id?: unknown;
    name?: unknown;
    size?: unknown;
    md5Checksum?: unknown;
    createdTime?: unknown;
};

type AccessToken = {
    value: string;
    expiresAt: number;
};

export function googleDriveStorageConfigFromEnvironment(): GoogleDriveStorageConfig {
    return {
        provider: String(process.env.CAMERA_CLOUD_STORAGE || 'disabled').trim().toLowerCase(),
        clientId: String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim(),
        clientSecret: String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim(),
        refreshToken: String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim(),
        folderId: String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim() || undefined,
        folderName: safeFolderName(process.env.GOOGLE_DRIVE_FOLDER_NAME),
    };
}

export function isTrustedGoogleDriveUploadUrl(value: string | null): value is string {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'www.googleapis.com'
            && url.pathname.startsWith('/upload/drive/');
    } catch {
        return false;
    }
}

export class GoogleDriveStorage {
    readonly readiness: { requested: boolean; enabled: boolean; reason?: string };
    private accessToken?: AccessToken;
    private resolvedFolderId?: string;

    constructor(
        private readonly config = googleDriveStorageConfigFromEnvironment(),
        private readonly fetchImpl: FetchLike = globalThis.fetch,
    ) {
        const requested = config.provider === 'google_drive';
        const missing = [
            config.clientId ? '' : 'GOOGLE_DRIVE_CLIENT_ID',
            config.clientSecret ? '' : 'GOOGLE_DRIVE_CLIENT_SECRET',
            config.refreshToken ? '' : 'GOOGLE_DRIVE_REFRESH_TOKEN',
        ].filter(Boolean);
        this.readiness = {
            requested,
            enabled: requested && missing.length === 0,
            ...(
                requested && missing.length
                    ? { reason: `credenciais ausentes: ${missing.join(', ')}` }
                    : {}
            ),
        };
    }

    async upload(filePath: string, request: GoogleDriveUploadRequest): Promise<GoogleDriveFile> {
        this.assertEnabled();
        const stats = statSync(filePath);
        if (!stats.isFile() || stats.size <= 0) throw new Error('google_drive_video_invalid');
        const md5Checksum = await fileMd5(filePath);
        const folderId = await this.ensureFolder();
        const existing = await this.findRecordingFile(folderId, request.recordingId);
        if (existing) {
            if (existing.size !== stats.size || existing.md5Checksum !== md5Checksum) {
                throw new Error('google_drive_existing_file_mismatch');
            }
            return existing;
        }

        const name = recordingFileName(request);
        const session = await this.authorizedFetch(
            `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,md5Checksum,createdTime`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Length': String(stats.size),
                    'X-Upload-Content-Type': 'video/mp4',
                },
                body: JSON.stringify({
                    name,
                    mimeType: 'video/mp4',
                    parents: [folderId],
                    appProperties: {
                        miniHasRecordingId: String(request.recordingId),
                        miniHasDeviceId: String(request.deviceId),
                    },
                }),
                signal: AbortSignal.timeout(30_000),
            },
        );
        if (!session.ok) throw new Error(`google_drive_session_http_${session.status}`);
        const uploadUrl = session.headers.get('location');
        if (!isTrustedGoogleDriveUploadUrl(uploadUrl)) {
            throw new Error('google_drive_upload_url_invalid');
        }

        const uploadedResponse = await this.authorizedFetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': String(stats.size),
                'Content-Type': 'video/mp4',
            },
            body: createReadStream(filePath) as any,
            duplex: 'half',
            signal: AbortSignal.timeout(15 * 60_000),
        });
        if (![200, 201].includes(uploadedResponse.status)) {
            throw new Error(`google_drive_upload_http_${uploadedResponse.status}`);
        }
        const uploadedPayload = await responseJson<DriveFilePayload>(uploadedResponse);
        const uploadedId = safeDriveId(uploadedPayload.id);
        const uploaded = uploadedId
            ? await this.getFile(uploadedId)
            : await this.findRecordingFile(folderId, request.recordingId);
        if (!uploaded) throw new Error('google_drive_upload_not_found');
        if (uploaded.size !== stats.size || uploaded.md5Checksum !== md5Checksum) {
            throw new Error('google_drive_upload_verification_failed');
        }
        return uploaded;
    }

    async stream(fileId: string, range?: string): Promise<Response> {
        this.assertEnabled();
        return this.authorizedFetch(`${DRIVE_API}/files/${encodeURIComponent(safeDriveId(fileId))}?alt=media`, {
            method: 'GET',
            headers: range ? { Range: range } : undefined,
            signal: AbortSignal.timeout(2 * 60_000),
        });
    }

    async download(
        fileId: string,
        destinationPath: string,
        expected: { size?: number; md5Checksum?: string } = {},
    ): Promise<void> {
        const response = await this.stream(fileId);
        if (!response.ok || !response.body) {
            throw new Error(`google_drive_download_http_${response.status}`);
        }
        try {
            await pipeline(
                Readable.fromWeb(response.body as any),
                createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
            );
            const stats = statSync(destinationPath);
            if (
                !stats.isFile()
                || stats.size <= 0
                || (expected.size !== undefined && stats.size !== expected.size)
                || (
                    expected.md5Checksum
                    && await fileMd5(destinationPath) !== expected.md5Checksum.toLowerCase()
                )
            ) {
                throw new Error('google_drive_download_verification_failed');
            }
        } catch (error) {
            rmSync(destinationPath, { force: true });
            throw error;
        }
    }

    async delete(fileId: string): Promise<void> {
        this.assertEnabled();
        const response = await this.authorizedFetch(
            `${DRIVE_API}/files/${encodeURIComponent(safeDriveId(fileId))}`,
            {
                method: 'DELETE',
                signal: AbortSignal.timeout(30_000),
            },
        );
        if (response.status !== 204 && response.status !== 404) {
            throw new Error(`google_drive_delete_http_${response.status}`);
        }
    }

    private assertEnabled(): void {
        if (!this.readiness.enabled) throw new Error('google_drive_not_configured');
    }

    private async authorizedFetch(input: string, init: FetchInit): Promise<Response> {
        const token = await this.token();
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return this.fetchImpl(input, { ...init, headers });
    }

    private async token(): Promise<string> {
        if (this.accessToken && this.accessToken.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
            return this.accessToken.value;
        }
        const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                refresh_token: this.config.refreshToken,
                grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`google_drive_token_http_${response.status}`);
        const payload = await responseJson<{ access_token?: unknown; expires_in?: unknown }>(response);
        const value = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
        const expiresIn = Number(payload.expires_in);
        if (!value || !Number.isFinite(expiresIn) || expiresIn <= 0) {
            throw new Error('google_drive_token_invalid');
        }
        this.accessToken = {
            value,
            expiresAt: Date.now() + Math.min(expiresIn, 86_400) * 1_000,
        };
        return value;
    }

    private async ensureFolder(): Promise<string> {
        if (this.config.folderId) return safeDriveId(this.config.folderId);
        if (this.resolvedFolderId) return this.resolvedFolderId;
        const folderName = this.config.folderName;
        const query = [
            `name = '${escapeDriveQueryValue(folderName)}'`,
            `mimeType = 'application/vnd.google-apps.folder'`,
            'trashed = false',
        ].join(' and ');
        const listed = await this.listFilePayloads(query);
        if (listed.length) {
            this.resolvedFolderId = safeDriveId(listed[0].id);
            return this.resolvedFolderId;
        }

        const response = await this.authorizedFetch(`${DRIVE_API}/files?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify({
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`google_drive_folder_http_${response.status}`);
        const payload = await responseJson<DriveFilePayload>(response);
        this.resolvedFolderId = safeDriveId(payload.id);
        return this.resolvedFolderId;
    }

    private async findRecordingFile(folderId: string, recordingId: number): Promise<GoogleDriveFile | undefined> {
        const query = [
            `'${escapeDriveQueryValue(folderId)}' in parents`,
            `appProperties has { key='miniHasRecordingId' and value='${recordingId}' }`,
            'trashed = false',
        ].join(' and ');
        const files = await this.listFiles(query);
        return files[0];
    }

    private async listFiles(query: string): Promise<GoogleDriveFile[]> {
        return (await this.listFilePayloads(query))
            .map((file) => normalizeDriveFile(file))
            .filter((file): file is GoogleDriveFile => Boolean(file));
    }

    private async listFilePayloads(query: string): Promise<DriveFilePayload[]> {
        const url = new URL(`${DRIVE_API}/files`);
        url.searchParams.set('q', query);
        url.searchParams.set('spaces', 'drive');
        url.searchParams.set('pageSize', '10');
        url.searchParams.set('fields', 'files(id,name,size,md5Checksum,createdTime)');
        const response = await this.authorizedFetch(url.toString(), {
            method: 'GET',
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`google_drive_list_http_${response.status}`);
        const payload = await responseJson<{ files?: unknown }>(response);
        if (!Array.isArray(payload.files)) return [];
        return payload.files.filter((file): file is DriveFilePayload => Boolean(file && typeof file === 'object'));
    }

    private async getFile(fileId: string): Promise<GoogleDriveFile | undefined> {
        const response = await this.authorizedFetch(
            `${DRIVE_API}/files/${encodeURIComponent(safeDriveId(fileId))}`
            + '?fields=id,name,size,md5Checksum,createdTime',
            {
                method: 'GET',
                signal: AbortSignal.timeout(30_000),
            },
        );
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`google_drive_get_http_${response.status}`);
        return normalizeDriveFile(await responseJson<DriveFilePayload>(response));
    }
}

function normalizeDriveFile(payload: DriveFilePayload): GoogleDriveFile | undefined {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const size = Number(payload.size);
    const md5Checksum = typeof payload.md5Checksum === 'string' ? payload.md5Checksum.trim().toLowerCase() : '';
    if (!id || !name || !Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{32}$/.test(md5Checksum)) {
        return undefined;
    }
    return {
        id: safeDriveId(id),
        name,
        size,
        md5Checksum,
        ...(typeof payload.createdTime === 'string' ? { createdTime: payload.createdTime } : {}),
    };
}

function safeDriveId(value: unknown): string {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || id.length > 256 || !/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error('google_drive_file_id_invalid');
    }
    return id;
}

function safeFolderName(value: string | undefined): string {
    const name = String(value || 'Mini-HAS').trim().slice(0, 100);
    return name || 'Mini-HAS';
}

function recordingFileName(request: GoogleDriveUploadRequest): string {
    const timestamp = request.startedAt.replace(/[^0-9A-Za-z_-]/g, '-').slice(0, 40);
    return `camera-${request.deviceId}-${timestamp}-${request.recordingId}.mp4`;
}

function escapeDriveQueryValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function fileMd5(filePath: string): Promise<string> {
    const digest = createHash('md5');
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
    return digest.digest('hex');
}

async function responseJson<T>(response: Response): Promise<T> {
    try {
        return JSON.parse(await response.text()) as T;
    } catch {
        throw new Error('google_drive_response_invalid');
    }
}
