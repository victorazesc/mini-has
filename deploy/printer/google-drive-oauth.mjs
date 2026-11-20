#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const args = parseArgs(process.argv.slice(2));
const clientFile = args.get('--client-json');
const outputFile = args.get('--output');
if (!clientFile || !outputFile) {
    process.stderr.write(
        'Uso: node google-drive-oauth.mjs --client-json oauth-client.json --output google-drive.env\n',
    );
    process.exit(2);
}

const clientPayload = JSON.parse(readFileSync(clientFile, 'utf8'));
const client = clientPayload.installed || clientPayload.web;
if (!client?.client_id || !client?.client_secret) {
    throw new Error('Arquivo OAuth do Google invalido.');
}

const state = randomBytes(24).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const server = createServer();
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Callback OAuth indisponivel.');
const redirectUri = `http://localhost:${address.port}/callback`;

const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.searchParams.set('client_id', client.client_id);
authorizationUrl.searchParams.set('redirect_uri', redirectUri);
authorizationUrl.searchParams.set('response_type', 'code');
authorizationUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
authorizationUrl.searchParams.set('access_type', 'offline');
authorizationUrl.searchParams.set('prompt', 'consent');
authorizationUrl.searchParams.set('state', state);
authorizationUrl.searchParams.set('code_challenge', challenge);
authorizationUrl.searchParams.set('code_challenge_method', 'S256');
process.stdout.write(`${authorizationUrl}\n`);

const callback = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
        server.close();
        reject(new Error('Tempo da autorizacao OAuth esgotado.'));
    }, 5 * 60_000);
    server.on('request', async (request, response) => {
        const callbackUrl = new URL(request.url || '/', redirectUri);
        if (callbackUrl.pathname !== '/callback') {
            response.writeHead(404).end();
            return;
        }
        try {
            if (callbackUrl.searchParams.get('state') !== state) {
                throw new Error('Estado OAuth invalido.');
            }
            const code = callbackUrl.searchParams.get('code');
            if (!code) throw new Error('Codigo OAuth ausente.');
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: client.client_id,
                    client_secret: client.client_secret,
                    code,
                    code_verifier: verifier,
                    grant_type: 'authorization_code',
                    redirect_uri: redirectUri,
                }),
                signal: AbortSignal.timeout(30_000),
            });
            if (!tokenResponse.ok) throw new Error(`Falha OAuth HTTP ${tokenResponse.status}.`);
            const tokens = await tokenResponse.json();
            if (!tokens.refresh_token) throw new Error('Google nao retornou refresh token.');

            writeFileSync(
                outputFile,
                [
                    envLine('GOOGLE_DRIVE_CLIENT_ID', client.client_id),
                    envLine('GOOGLE_DRIVE_CLIENT_SECRET', client.client_secret),
                    envLine('GOOGLE_DRIVE_REFRESH_TOKEN', tokens.refresh_token),
                    '',
                ].join('\n'),
                { mode: 0o600 },
            );
            chmodSync(outputFile, 0o600);
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Google Drive autorizado. Pode fechar esta pagina.');
            clearTimeout(timer);
            resolve();
        } catch (error) {
            response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Nao foi possivel concluir a autorizacao.');
            clearTimeout(timer);
            reject(error);
        } finally {
            server.close();
        }
    });
});

await callback;
process.stdout.write(`Credenciais salvas com permissao 0600 em ${outputFile}.\n`);

function parseArgs(values) {
    const parsed = new Map();
    for (let index = 0; index < values.length; index += 2) {
        parsed.set(values[index], values[index + 1]);
    }
    return parsed;
}

function envLine(key, value) {
    const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '');
    return `${key}="${escaped}"`;
}
