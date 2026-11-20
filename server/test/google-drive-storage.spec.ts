import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    GoogleDriveStorage,
    GoogleDriveStorageConfig,
    isTrustedGoogleDriveUploadUrl,
} from '../src/modules/camera-recording/google-drive-storage';

const enabledConfig: GoogleDriveStorageConfig = {
    provider: 'google_drive',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    folderName: 'Mini-HAS',
};

test('Google Drive stays disabled until every OAuth credential exists', () => {
    const storage = new GoogleDriveStorage({
        ...enabledConfig,
        refreshToken: '',
    });

    assert.equal(storage.readiness.requested, true);
    assert.equal(storage.readiness.enabled, false);
    assert.match(storage.readiness.reason || '', /GOOGLE_DRIVE_REFRESH_TOKEN/);
});

test('Google Drive accepts only resumable upload URLs from the trusted host', () => {
    assert.equal(
        isTrustedGoogleDriveUploadUrl('https://www.googleapis.com/upload/drive/v3/files?upload_id=abc'),
        true,
    );
    assert.equal(isTrustedGoogleDriveUploadUrl('https://evil.example/upload/drive/v3/files'), false);
    assert.equal(isTrustedGoogleDriveUploadUrl('http://www.googleapis.com/upload/drive/v3/files'), false);
});

test('Google Drive creates its folder, uploads and verifies size and MD5', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mini-has-drive-'));
    const videoPath = join(directory, 'clip.mp4');
    const contents = Buffer.from('mini-has-video');
    writeFileSync(videoPath, contents);
    const md5Checksum = createHash('md5').update(contents).digest('hex');
    const calls: Array<{ url: string; init?: RequestInit & { duplex?: string } }> = [];

    const fetchMock = async (
        input: string | URL | Request,
        init?: RequestInit & { duplex?: 'half' },
    ): Promise<Response> => {
        const url = String(input);
        calls.push({ url, init });
        if (url === 'https://oauth2.googleapis.com/token') {
            return jsonResponse({ access_token: 'access-token', expires_in: 3600 });
        }
        if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && init?.method === 'GET') {
            const query = new URL(url).searchParams.get('q') || '';
            if (query.includes('mimeType')) {
                return jsonResponse({ files: [] });
            }
            return jsonResponse({ files: [] });
        }
        if (url === 'https://www.googleapis.com/drive/v3/files?fields=id' && init?.method === 'POST') {
            return jsonResponse({ id: 'folder_123' });
        }
        if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?') && init?.method === 'POST') {
            return new Response('', {
                status: 200,
                headers: {
                    location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session_123',
                },
            });
        }
        if (url.includes('upload_id=session_123') && init?.method === 'PUT') {
            for await (const _chunk of init.body as any) {
                // Consume the stream exactly as fetch does.
            }
            return jsonResponse({
                id: 'file_123',
                name: 'clip.mp4',
                size: String(contents.length),
                md5Checksum,
            });
        }
        if (url === 'https://www.googleapis.com/drive/v3/files/file_123?fields=id,name,size,md5Checksum,createdTime') {
            return jsonResponse({
                id: 'file_123',
                name: 'clip.mp4',
                size: String(contents.length),
                md5Checksum,
                createdTime: '2026-07-30T20:00:00.000Z',
            });
        }
        throw new Error(`unexpected fetch: ${init?.method} ${url}`);
    };

    try {
        const storage = new GoogleDriveStorage(enabledConfig, fetchMock);
        const uploaded = await storage.upload(videoPath, {
            recordingId: 42,
            deviceId: 16,
            startedAt: '2026-07-30T20:00:00.000Z',
        });

        assert.equal(uploaded.id, 'file_123');
        assert.equal(uploaded.size, contents.length);
        assert.equal(uploaded.md5Checksum, md5Checksum);
        const put = calls.find((call) => call.init?.method === 'PUT');
        assert.equal(put?.init?.duplex, 'half');
        assert.equal(new Headers(put?.init?.headers).get('Authorization'), 'Bearer access-token');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Google Drive forwards byte ranges when streaming a cloud clip', async () => {
    const fetchMock = async (
        input: string | URL | Request,
        init?: RequestInit & { duplex?: 'half' },
    ): Promise<Response> => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
            return jsonResponse({ access_token: 'access-token', expires_in: 3600 });
        }
        assert.equal(
            url,
            'https://www.googleapis.com/drive/v3/files/file_123?alt=media',
        );
        assert.equal(new Headers(init?.headers).get('Range'), 'bytes=10-19');
        return new Response('0123456789', {
            status: 206,
            headers: { 'Content-Range': 'bytes 10-19/100' },
        });
    };
    const storage = new GoogleDriveStorage(enabledConfig, fetchMock);

    const response = await storage.stream('file_123', 'bytes=10-19');

    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 10-19/100');
});

test('Google Drive verifies a downloaded cloud clip before semantic reuse', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mini-has-drive-download-'));
    const destination = join(directory, 'clip.mp4');
    const contents = Buffer.from('cloud-video');
    const md5Checksum = createHash('md5').update(contents).digest('hex');
    const fetchMock = async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
            return jsonResponse({ access_token: 'access-token', expires_in: 3600 });
        }
        assert.equal(url, 'https://www.googleapis.com/drive/v3/files/file_123?alt=media');
        return new Response(contents);
    };

    try {
        const storage = new GoogleDriveStorage(enabledConfig, fetchMock);
        await storage.download('file_123', destination, {
            size: contents.length,
            md5Checksum,
        });

        assert.deepEqual(readFileSync(destination), contents);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
