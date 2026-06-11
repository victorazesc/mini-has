import { Injectable } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { InboxDevice, InboxStatus, JsonObject } from '../../types';
import { DeviceService } from '../device/device.service';
import { EntityService } from '../entity/entity.service';

@Injectable()
export class InboxService {
    constructor(
        private readonly storage: StorageService,
        private readonly devices: DeviceService,
        private readonly entities: EntityService,
    ) { }

    listInboxDevices(status?: InboxStatus, provider?: string): InboxDevice[] {
        let sql = 'SELECT * FROM device_inbox';
        const params: unknown[] = [];
        if (status) {
            sql += ' WHERE status = ?';
            params.push(status);
        }
        sql += ' ORDER BY updated_at DESC, id DESC';

        let devices = this.storage.all<JsonObject>(sql, params).map((row) => this.fromInboxRow(row));

        if (provider) {
            const normalizedProvider = provider.trim();
            devices = devices.filter((device) => String(device.payload.provider || '').trim() === normalizedProvider);
        }

        if (status === 'pending') {
            devices = devices.filter((device) => !this.hasAcceptedOrAddedInboxDevice(device));
        }

        return dedupeInboxDevices(devices);
    }

    acceptInboxDevice(inboxId: number, body: JsonObject) {
        const item = this.getInboxPayloadWithSecrets(inboxId);
        if (!item) return null;

        const device = this.devices.acceptInboxDevice(item.inbox, item.secrets, body.name as string | null | undefined, body.roomId as number | null | undefined);

        if (body.createEntities ?? true) {
            this.entities.createEntitiesForDevice(device.id, device.provider, device.externalId, item.inbox.payload.entities || []);
        }

        this.markInboxStatus(inboxId, 'accepted');
        this.markInboxDuplicatesStatus(device.provider, device.externalId, 'accepted');
        return device;
    }

    ignoreInboxDevice(inboxId: number) {
        return this.markInboxStatus(inboxId, 'ignored');
    }

    getInboxDevice(inboxId: number): InboxDevice | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM device_inbox WHERE id = ?', [inboxId]);
        return row ? this.fromInboxRow(row) : null;
    }

    deleteInboxItems(inboxIds: number[]): void {
        if (!inboxIds.length) return;
        const placeholders = inboxIds.map(() => '?').join(', ');
        this.storage.run(`DELETE FROM device_inbox WHERE id IN (${placeholders})`, inboxIds);
    }

    deleteInboxItemsBySource(sourceType: string, sourceId: number): void {
        this.storage.run('DELETE FROM device_inbox WHERE source_type = ? AND source_id = ?', [sourceType, sourceId]);
    }

    upsertInboxItem(sourceType: string, sourceId: number, externalId: string, payload: JsonObject, secrets: JsonObject = {}, matchScore = 0): number {
        const now = this.storage.utcNow();
        const provider = String(payload.provider || '').trim();
        const existingByProvider =
            provider && externalId
                ? this.storage.get<JsonObject>(
                    `
            SELECT id, status FROM device_inbox
            WHERE external_id = ? AND json_extract(payload_json, '$.provider') = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            `,
                    [externalId, provider],
                )
                : null;
        const existing = existingByProvider || this.storage.get<JsonObject>(
            `
      SELECT id, status FROM device_inbox
      WHERE source_type = ? AND source_id = ? AND external_id = ?
      `,
            [sourceType, sourceId, externalId],
        );
        if (existing) {
            this.storage.run(
                `
        UPDATE device_inbox
        SET payload_json = ?, secrets_json = ?, match_score = ?, updated_at = ?
        WHERE id = ?
        `,
                [this.storage.jsonDump(payload), this.storage.jsonDump(secrets), matchScore, now, existing.id],
            );
            return Number(existing.id);
        }
        const result = this.storage.run(
            `
      INSERT INTO device_inbox
        (source_type, source_id, external_id, status, payload_json, secrets_json, match_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [sourceType, sourceId, externalId, 'pending', this.storage.jsonDump(payload), this.storage.jsonDump(secrets), matchScore, now, now],
        );
        return Number(result.lastInsertRowid);
    }

    private getInboxPayloadWithSecrets(inboxId: number): { inbox: InboxDevice; secrets: JsonObject } | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM device_inbox WHERE id = ?', [inboxId]);
        if (!row) return null;
        return { inbox: this.fromInboxRow(row), secrets: this.storage.jsonLoad(row.secrets_json, {}) };
    }

    private markInboxStatus(inboxId: number, status: InboxStatus): InboxDevice | null {
        this.storage.run('UPDATE device_inbox SET status = ?, updated_at = ? WHERE id = ?', [status, this.storage.utcNow(), inboxId]);
        return this.getInboxDevice(inboxId);
    }

    private markInboxDuplicatesStatus(provider: string, externalId: string, status: InboxStatus): void {
        if (!provider || !externalId) return;
        this.storage.run(
            `
      UPDATE device_inbox
      SET status = ?, updated_at = ?
      WHERE external_id = ? AND json_extract(payload_json, '$.provider') = ?
      `,
            [status, this.storage.utcNow(), externalId, provider],
        );
    }

    private hasAcceptedOrAddedInboxDevice(device: InboxDevice): boolean {
        if (device.sourceType === 'discovery' || String(device.payload.provider || '') === 'discovery') {
            const identification = nested(device.payload, 'identification') || {};
            const isGenericTuyaDiscovery =
                String(device.payload.manufacturer || '').trim().toLowerCase() === 'tuya' ||
                String(identification.label || '').trim() === 'Dispositivo Tuya local';

            if (isGenericTuyaDiscovery && this.devices.listDevices().some((savedDevice) => savedDevice.provider === 'tuya_cloud')) {
                return true;
            }

            const discoveryMac = String(device.payload.mac || '').toUpperCase();
            const discoveryIp = String(device.payload.ip || '');
            if (discoveryMac || discoveryIp) {
                const savedDevices = this.devices.listDevices();
                const matched = savedDevices.some((savedDevice) => {
                    const local = nested(savedDevice.payload, 'local') || {};
                    const payloadStatus = nested(savedDevice.payload, 'status') || {};
                    const runtimeState = nested(payloadStatus, 'state') || {};
                    const savedMac = String(local.mac || '').toUpperCase();
                    const savedIp = String(firstNonEmpty(local.ip, runtimeState.ip) || '');
                    if (discoveryMac && savedMac) return discoveryMac === savedMac;
                    return Boolean(discoveryIp && savedIp && discoveryIp === savedIp);
                });
                if (matched) return true;
            }
        }

        const provider = String(device.payload.provider || device.sourceType || '').trim();
        const externalId = String(device.payload.externalId || device.externalId || '').trim();
        if (!provider || !externalId) return false;

        const savedDevice = this.storage.get<JsonObject>('SELECT id FROM devices WHERE provider = ? AND external_id = ? LIMIT 1', [provider, externalId]);
        if (savedDevice) return true;

        const acceptedInbox = this.storage.get<JsonObject>(
            `
      SELECT id FROM device_inbox
      WHERE status = 'accepted' AND external_id = ? AND json_extract(payload_json, '$.provider') = ?
      LIMIT 1
      `,
            [externalId, provider],
        );
        return Boolean(acceptedInbox);
    }

    private fromInboxRow(row: JsonObject): InboxDevice {
        return {
            id: row.id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            externalId: row.external_id,
            status: row.status,
            payload: this.storage.jsonLoad(row.payload_json, {}),
            matchScore: row.match_score,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

function dedupeInboxDevices(devices: InboxDevice[]): InboxDevice[] {
    const seen = new Set<string>();
    const result: InboxDevice[] = [];
    for (const device of devices) {
        const provider = String(device.payload.provider || device.sourceType || '').trim();
        const externalId = String(device.payload.externalId || device.externalId || '').trim();
        const key = provider && externalId ? `${provider}:${externalId}` : `${device.sourceType}:${device.sourceId}:${device.externalId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(device);
    }
    return result;
}

function nested(value: JsonObject, ...keys: string[]): any {
    let current: any = value;
    for (const key of keys) {
        if (!current || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
}

function firstNonEmpty(...values: any[]): any {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && !value.trim()) continue;
        return value;
    }
    return null;
}
