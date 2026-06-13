import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ProvidersService } from '../../infrastructure/providers/providers.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { InboxDevice, Integration, IntegrationStatus, IntegrationType, JsonObject, StoredIntegration } from '../../types';
import { DeviceService } from '../device/device.service';
import { EntityService } from '../entity/entity.service';
import { InboxService } from '../inbox/inbox.service';

export const INTEGRATION_SYNC_SERVICE = 'INTEGRATION_SYNC_SERVICE';

@Injectable()
export class IntegrationService {
    constructor(
        private readonly storage: StorageService,
        private readonly providers: ProvidersService,
        private readonly devices: DeviceService,
        private readonly entities: EntityService,
        private readonly inbox: InboxService,
    ) { }

    listIntegrations(): Integration[] {
        return this.storage.all<JsonObject>('SELECT * FROM integrations ORDER BY id')
            .map((row) => this.publicIntegration(this.fromIntegrationRow(row)));
    }

    getIntegration(integrationId: number): StoredIntegration | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM integrations WHERE id = ?', [integrationId]);
        return row ? this.fromIntegrationRow(row) : null;
    }

    publicIntegration(integration: StoredIntegration): Integration {
        const { secrets: _secrets, ...publicValue } = integration;
        return publicValue;
    }

    async updateIntegration(integrationId: number, body: JsonObject) {
        const integration = this.getIntegration(integrationId);
        if (!integration) return null;

        const name = String(body.name || integration.name).trim();
        if (!name) throw new HttpException({ detail: 'Nome e obrigatorio.' }, HttpStatus.BAD_REQUEST);

        const [configPatch, secretPatch] = this.providers.splitProviderConfig(integration.type, body.config || {});
        const config = { ...integration.config, ...withoutEmptyValues(configPatch) };
        const secrets = { ...integration.secrets, ...withoutEmptyValues(secretPatch) };

        let status: IntegrationStatus = 'created';
        if (body.testOnUpdate ?? body.test_on_update ?? true) {
            const now = new Date().toISOString();
            const pending: StoredIntegration = { ...integration, name, status: 'created', config, secrets, updatedAt: now };
            const result = await this.providers.testProvider(pending);
            if (!result.ok) throw new HttpException({ detail: result.message }, HttpStatus.BAD_REQUEST);
            status = result.status;
        }

        const updated = this.updateIntegrationRecord(integrationId, name, config, secrets, status);
        return updated ? this.publicIntegration(updated) : null;
    }

    async createIntegration(body: JsonObject) {
        const type = body.type as IntegrationType;
        const [config, secrets] = this.providers.splitProviderConfig(type, body.config || {});

        if (type === 'tuya_cloud') {
            const accessId = String(config.accessId || '').trim();
            if (accessId) config.accessId = accessId;
            if (this.findIntegrationByConfigValue(type, 'accessId', accessId)) {
                throw new HttpException({ detail: 'Ja existe uma integracao Tuya Cloud com este Access ID.' }, HttpStatus.CONFLICT);
            }
        }

        let status: IntegrationStatus = 'created';
        if (body.testOnCreate ?? body.test_on_create ?? true) {
            const now = new Date().toISOString();
            const pending: StoredIntegration = { id: 0, type, name: body.name, status: 'created', config, secrets, createdAt: now, updatedAt: now };
            const result = await this.providers.testProvider(pending);
            if (!result.ok) throw new HttpException({ detail: result.message }, HttpStatus.BAD_REQUEST);
            status = result.status;
        }

        if (type === 'smartthings_cloud') {
            const existing = this.findLatestIntegrationByType(type);
            if (existing) {
                const updated = this.updateIntegrationConfigAndSecrets(existing.id, { ...existing.config, ...config }, { ...existing.secrets, ...secrets }, status);
                if (updated) return this.publicIntegration(updated);
            }
        }

        return this.publicIntegration(this.createIntegrationRecord(body, config, secrets, status));
    }

    async testIntegration(integrationId: number) {
        const integration = this.getIntegration(integrationId);
        if (!integration) return null;

        const result = await this.providers.testProvider(integration);
        this.updateIntegrationStatus(integrationId, result.status, result.ok ? null : result.message);
        return { ...result, details: result.details || {} };
    }

    async syncIntegration(integrationId: number) {
        const integration = this.getIntegration(integrationId);
        if (!integration) return null;

        this.updateIntegrationStatus(integrationId, 'syncing');
        try {
            const [devices, details] = await this.providers.syncProvider(integration);
            const inboxIds: number[] = [];
            const inboxDevices: InboxDevice[] = [];
            const savedDevices = this.devices.listDevices();

            for (const device of devices) {
                const { secrets, ...payload } = device;
                const inboxId = this.inbox.upsertInboxItem('integration', integrationId, device.externalId, payload, secrets || {}, device.ip ? 0.75 : 0.5);
                inboxIds.push(inboxId);
                const inboxDevice = this.inbox.getInboxDevice(inboxId);
                if (inboxDevice) inboxDevices.push(inboxDevice);

                const savedDevice = savedDevices.find((item) => item.provider === device.provider && item.externalId === device.externalId);
                if (savedDevice) {
                    this.devices.syncAcceptedProviderDevice(savedDevice.id, device, secrets || {});
                    if (device.entities?.length) {
                        this.entities.createEntitiesForDevice(savedDevice.id, savedDevice.provider, savedDevice.externalId, device.entities);
                    }
                }
            }

            this.updateIntegrationStatus(integrationId, 'connected', null, new Date().toISOString());
            return {
                ok: true,
                integrationId,
                imported: inboxIds.length,
                inboxIds,
                inboxDevices,
                message: 'Sync concluido.',
                details,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateIntegrationStatus(integrationId, 'error', message);
            return { ok: false, integrationId, imported: 0, inboxIds: [], message };
        }
    }

    deleteIntegration(integrationId: number): boolean {
        return this.storage.transaction(() => {
            const integration = this.getIntegration(integrationId);
            if (!integration) return false;

            const linkedInboxIds = this.devices.deleteDevicesForIntegration(integrationId);
            this.inbox.deleteInboxItems(linkedInboxIds);
            this.inbox.deleteInboxItemsBySource('integration', integrationId);

            return this.storage.run('DELETE FROM integrations WHERE id = ?', [integrationId]).changes > 0;
        });
    }

    private createIntegrationRecord(body: JsonObject, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration {
        const now = this.storage.utcNow();
        const result = this.storage.run(
            `
      INSERT INTO integrations (type, name, status, config_json, secrets_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
            [body.type, body.name, status, this.storage.jsonDump(config), this.storage.jsonDump(secrets), now, now],
        );
        return this.getIntegration(Number(result.lastInsertRowid)) as StoredIntegration;
    }

    private findIntegrationByConfigValue(providerType: IntegrationType, key: string, value: string): StoredIntegration | null {
        const normalized = value.trim();
        if (!normalized) return null;
        for (const row of this.storage.all<JsonObject>('SELECT * FROM integrations WHERE type = ?', [providerType])) {
            const config = this.storage.jsonLoad<JsonObject>(row.config_json, {});
            if (String(config[key] || '').trim() === normalized) return this.fromIntegrationRow(row);
        }
        return null;
    }

    private findLatestIntegrationByType(providerType: IntegrationType): StoredIntegration | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM integrations WHERE type = ? ORDER BY id DESC LIMIT 1', [providerType]);
        return row ? this.fromIntegrationRow(row) : null;
    }

    private updateIntegrationConfigAndSecrets(integrationId: number, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration | null {
        this.storage.run(
            `
      UPDATE integrations
      SET status = ?, config_json = ?, secrets_json = ?, error = NULL, updated_at = ?
      WHERE id = ?
      `,
            [status, this.storage.jsonDump(config), this.storage.jsonDump(secrets), this.storage.utcNow(), integrationId],
        );
        return this.getIntegration(integrationId);
    }

    private updateIntegrationRecord(integrationId: number, name: string, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration | null {
        this.storage.run(
            `
      UPDATE integrations
      SET name = ?, status = ?, config_json = ?, secrets_json = ?, error = NULL, updated_at = ?
      WHERE id = ?
      `,
            [name, status, this.storage.jsonDump(config), this.storage.jsonDump(secrets), this.storage.utcNow(), integrationId],
        );
        return this.getIntegration(integrationId);
    }

    private updateIntegrationStatus(integrationId: number, status: IntegrationStatus, error?: string | null, lastSyncAt?: string | null): StoredIntegration | null {
        this.storage.run(
            `
      UPDATE integrations
      SET status = ?, error = ?, last_sync_at = COALESCE(?, last_sync_at), updated_at = ?
      WHERE id = ?
      `,
            [status, error || null, lastSyncAt || null, this.storage.utcNow(), integrationId],
        );
        return this.getIntegration(integrationId);
    }

    private fromIntegrationRow(row: JsonObject): StoredIntegration {
        return {
            id: row.id,
            type: row.type,
            name: row.name,
            status: row.status,
            config: this.storage.jsonLoad(row.config_json, {}),
            secrets: this.storage.jsonLoad(row.secrets_json, {}),
            error: row.error,
            lastSyncAt: row.last_sync_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

function withoutEmptyValues(value: JsonObject): JsonObject {
    return Object.fromEntries(
        Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ''),
    );
}
