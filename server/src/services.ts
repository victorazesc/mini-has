import { Injectable } from '@nestjs/common';
import {
  CommandRequest,
  CommandResult,
  Device,
  Entity,
  InboxDevice,
  InboxStatus,
  Integration,
  IntegrationStatus,
  IntegrationType,
  JsonObject,
  ProviderEntity,
  Room,
  StoredIntegration,
} from './types';
import { StorageService } from './storage';

@Injectable()
export class HomeService {
  constructor(private readonly storage: StorageService) {}

  listRooms(): Room[] {
    const rows = this.storage.all<JsonObject>('SELECT * FROM rooms ORDER BY name');
    return rows.map(fromRoomRow);
  }

  getRoom(roomId: number): Room | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM rooms WHERE id = ?', [roomId]);
    return row ? fromRoomRow(row) : null;
  }

  createRoom(request: JsonObject): Room {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      'INSERT INTO rooms (name, icon, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [request.name, request.icon, request.description, now, now],
    );
    return this.getRoom(Number(result.lastInsertRowid)) as Room;
  }

  updateRoom(roomId: number, request: JsonObject): Room | null {
    const current = this.getRoom(roomId);
    if (!current) return null;
    const fieldMap: Record<string, string> = { name: 'name', icon: 'icon', description: 'description' };
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [source, target] of Object.entries(fieldMap)) {
      if (has(request, source)) {
        assignments.push(`${target} = ?`);
        values.push(request[source]);
      }
    }
    if (!assignments.length) return current;
    assignments.push('updated_at = ?');
    values.push(this.storage.utcNow(), roomId);
    this.storage.run(`UPDATE rooms SET ${assignments.join(', ')} WHERE id = ?`, values);
    return this.getRoom(roomId);
  }

  deleteRoom(roomId: number): boolean {
    return this.storage.transaction(() => {
      this.storage.run('UPDATE devices SET room_id = NULL WHERE room_id = ?', [roomId]);
      return this.storage.run('DELETE FROM rooms WHERE id = ?', [roomId]).changes > 0;
    });
  }

  listDevices(): Device[] {
    const rows = this.storage.all<JsonObject>(`
      SELECT devices.*, rooms.name AS room_name
      FROM devices
      LEFT JOIN rooms ON rooms.id = devices.room_id
      ORDER BY devices.id
    `);
    return rows.map((row) => this.fromDeviceRow(row));
  }

  getDevice(deviceId: number): Device | null {
    const row = this.storage.get<JsonObject>(
      `
      SELECT devices.*, rooms.name AS room_name
      FROM devices
      LEFT JOIN rooms ON rooms.id = devices.room_id
      WHERE devices.id = ?
      `,
      [deviceId],
    );
    return row ? this.fromDeviceRow(row) : null;
  }

  getDeviceWithSecrets(deviceId: number): { device: Device; secrets: JsonObject } | null {
    const row = this.storage.get<JsonObject>(
      `
      SELECT devices.*, rooms.name AS room_name
      FROM devices
      LEFT JOIN rooms ON rooms.id = devices.room_id
      WHERE devices.id = ?
      `,
      [deviceId],
    );
    if (!row) return null;
    return { device: this.fromDeviceRow(row), secrets: this.storage.jsonLoad(row.secrets_json, {}) };
  }

  createDevice(request: JsonObject): Device {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      `
      INSERT INTO devices
        (integration_id, inbox_id, external_id, local_device_key, name, device_type, provider, room_id,
         payload_json, secrets_json, capabilities_json, status_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        null,
        null,
        request.externalId,
        request.localDeviceKey,
        request.name,
        request.deviceType || 'unknown',
        request.provider || 'manual',
        request.roomId,
        this.storage.jsonDump(request.payload || {}),
        '{}',
        this.storage.jsonDump(request.capabilities || {}),
        this.storage.jsonDump(request.status || {}),
        now,
        now,
      ],
    );
    return this.getDevice(Number(result.lastInsertRowid)) as Device;
  }

  updateDevice(deviceId: number, request: JsonObject): Device | null {
    const current = this.getDevice(deviceId);
    if (!current) return null;
    const fieldMap: Record<string, string> = {
      name: 'name',
      deviceType: 'device_type',
      roomId: 'room_id',
      localDeviceKey: 'local_device_key',
    };
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [source, target] of Object.entries(fieldMap)) {
      if (has(request, source)) {
        assignments.push(`${target} = ?`);
        values.push(request[source]);
      }
    }
    for (const [source, target] of [
      ['payload', 'payload_json'],
      ['capabilities', 'capabilities_json'],
      ['status', 'status_json'],
    ] as const) {
      if (has(request, source)) {
        assignments.push(`${target} = ?`);
        values.push(this.storage.jsonDump(request[source] || {}));
      }
    }
    if (!assignments.length) return current;
    assignments.push('updated_at = ?');
    values.push(this.storage.utcNow(), deviceId);
    this.storage.run(`UPDATE devices SET ${assignments.join(', ')} WHERE id = ?`, values);
    return this.getDevice(deviceId);
  }

  deleteDevice(deviceId: number): boolean {
    return this.storage.transaction(() => {
      this.storage.run('DELETE FROM entities WHERE device_id = ?', [deviceId]);
      return this.storage.run('DELETE FROM devices WHERE id = ?', [deviceId]).changes > 0;
    });
  }

  linkLocalDevice(deviceId: number, localDeviceKey: string, payload: JsonObject = {}): Device | null {
    const device = this.getDevice(deviceId);
    if (!device) return null;
    const nextPayload = { ...device.payload, local: payload, localDeviceKey };
    this.storage.run('UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
      localDeviceKey,
      this.storage.jsonDump(nextPayload),
      this.storage.utcNow(),
      deviceId,
    ]);
    return this.getDevice(deviceId);
  }

  autoLinkLocalDevice(deviceId: number): Device | null {
    const item = this.getDeviceWithSecrets(deviceId);
    if (!item) return null;
    const local = this.findLocalMatch(item.device, item.secrets);
    if (!local) return item.device;
    const localDeviceKey = `local:${local.ip}:${item.device.externalId}`;
    const nextPayload = { ...item.device.payload, local, localDeviceKey };
    this.storage.run('UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
      localDeviceKey,
      this.storage.jsonDump(nextPayload),
      this.storage.utcNow(),
      deviceId,
    ]);
    return this.getDevice(deviceId);
  }

  autoLinkLocalDevices(): Device[] {
    return this.listDevices().map((device) => this.autoLinkLocalDevice(device.id)).filter(Boolean) as Device[];
  }

  updateDeviceRuntimeState(deviceId: number, commandResult: CommandResult): Device | null {
    if (!commandResult.ok) return this.getDevice(deviceId);
    if (commandResult.result.provider === 'smartthings_cloud' && commandResult.result.action === 'query' && isObject(commandResult.result.statusSummary)) {
      return this.updateSmartthingsQueryState(deviceId, commandResult.result);
    }
    if (commandResult.result.provider === 'mqtt' && isObject(commandResult.result.statusSummary)) {
      return this.updateMqttRuntimeState(deviceId, commandResult.result);
    }
    const dps = commandResult.result.dps;
    if (!isObject(dps) || !Object.keys(dps).length) return this.getDevice(deviceId);
    const current = this.getDevice(deviceId);
    if (!current) return null;

    const now = this.storage.utcNow();
    const currentDps = isObject(current.status.dps) ? current.status.dps : {};
    const mergedDps = { ...stringifyKeys(currentDps), ...stringifyKeys(dps) };
    const activeDpsId = String(commandResult.result.dpsId || primaryDpsId(current));
    const currentValue = mergedDps[activeDpsId];
    const status = {
      ...current.status,
      state: stateFromValue(currentValue, current.deviceType),
      online: true,
      lastSeenAt: now,
      dps: mergedDps,
    };
    const capabilities = {
      ...current.capabilities,
      status: mergeStatusEntries(current.capabilities.status || [], dps),
    };
    const payload = {
      ...current.payload,
      lastStatus: mergedDps,
      lastSeenAt: now,
    };
    this.storage.run(
      `
      UPDATE devices
      SET status_json = ?, capabilities_json = ?, payload_json = ?, updated_at = ?
      WHERE id = ?
      `,
      [this.storage.jsonDump(status), this.storage.jsonDump(capabilities), this.storage.jsonDump(payload), now, deviceId],
    );
    this.updateEntitiesRuntimeState(deviceId, mergedDps, now);
    return this.getDevice(deviceId);
  }

  logDeviceCommand(deviceId: number, request: CommandRequest, result: CommandResult): void {
    this.storage.run(
      `
      INSERT INTO device_command_logs (device_id, command_json, result_json, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [deviceId, this.storage.jsonDump(redactSecrets(request)), this.storage.jsonDump(result), result.status, this.storage.utcNow()],
    );
  }

  listEntities(): Entity[] {
    return this.storage.all<JsonObject>('SELECT * FROM entities ORDER BY id').map((row) => this.fromEntityRow(row));
  }

  getEntity(entityId: number): Entity | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM entities WHERE id = ?', [entityId]);
    return row ? this.fromEntityRow(row) : null;
  }

  createEntitiesForDevice(deviceId: number, provider: string, externalId: string, entities: ProviderEntity[]): Entity[] {
    const now = this.storage.utcNow();
    this.storage.transaction(() => {
      for (const entity of entities || []) {
        const key = String(entity.key || entity.type || 'main');
        const uniqueKey = `${provider}:${externalId}:${key}`;
        this.storage.run(
          `
          INSERT INTO entities
            (device_id, unique_key, type, name, command_schema_json, state_json, capabilities_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(unique_key) DO UPDATE SET
            device_id = excluded.device_id,
            type = excluded.type,
            name = excluded.name,
            command_schema_json = excluded.command_schema_json,
            state_json = excluded.state_json,
            capabilities_json = excluded.capabilities_json,
            updated_at = excluded.updated_at
          `,
          [
            deviceId,
            uniqueKey,
            entity.type || 'unknown',
            entity.name || 'Entidade',
            this.storage.jsonDump(entity.commandSchema || {}),
            this.storage.jsonDump(entity.state || {}),
            this.storage.jsonDump(entity.capabilities || {}),
            now,
            now,
          ],
        );
      }
    });
    return this.storage.all<JsonObject>('SELECT * FROM entities WHERE device_id = ? ORDER BY id', [deviceId]).map((row) => this.fromEntityRow(row));
  }

  logEntityCommand(entityId: number, request: CommandRequest): CommandResult | null {
    const entity = this.getEntity(entityId);
    if (!entity) return null;
    const result: CommandResult = {
      ok: true,
      status: 'accepted',
      message: 'Comando registrado. Runtime especifico do provider sera plugado na proxima etapa.',
      result: { entityId, command: request.command, params: request.params || {} },
    };
    this.storage.run(
      `
      INSERT INTO command_logs (entity_id, command_json, result_json, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [entityId, this.storage.jsonDump(request), this.storage.jsonDump(result), result.status, this.storage.utcNow()],
    );
    return result;
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

  getInboxDevice(inboxId: number): InboxDevice | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM device_inbox WHERE id = ?', [inboxId]);
    return row ? this.fromInboxRow(row) : null;
  }

  getInboxPayloadWithSecrets(inboxId: number): { inbox: InboxDevice; secrets: JsonObject } | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM device_inbox WHERE id = ?', [inboxId]);
    if (!row) return null;
    return { inbox: this.fromInboxRow(row), secrets: this.storage.jsonLoad(row.secrets_json, {}) };
  }

  markInboxStatus(inboxId: number, status: InboxStatus): InboxDevice | null {
    this.storage.run('UPDATE device_inbox SET status = ?, updated_at = ? WHERE id = ?', [status, this.storage.utcNow(), inboxId]);
    return this.getInboxDevice(inboxId);
  }

  markInboxDuplicatesStatus(provider: string, externalId: string, status: InboxStatus): void {
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

  acceptInboxDevice(inbox: InboxDevice, secrets: JsonObject, name?: string | null, roomId?: number | null): Device {
    const payload = inbox.payload;
    const now = this.storage.utcNow();
    const provider = String(payload.provider || inbox.sourceType);
    const externalId = String(payload.externalId || inbox.externalId);
    const deviceId = this.storage.transaction(() => {
      const existing = this.storage.get<JsonObject>('SELECT id FROM devices WHERE provider = ? AND external_id = ?', [provider, externalId]);
      const values = [
        inbox.sourceType === 'integration' ? inbox.sourceId : null,
        inbox.id,
        externalId,
        payload.localDeviceKey,
        name || payload.name || 'Dispositivo',
        payload.deviceType || 'unknown',
        provider,
        roomId,
        this.storage.jsonDump(payload),
        this.storage.jsonDump(secrets),
        this.storage.jsonDump(payload.capabilities || {}),
        this.storage.jsonDump(payload.status || {}),
        now,
      ];
      if (existing) {
        this.storage.run(
          `
          UPDATE devices
          SET integration_id = ?, inbox_id = ?, external_id = ?, local_device_key = ?, name = ?,
              device_type = ?, provider = ?, room_id = COALESCE(?, room_id), payload_json = ?,
              secrets_json = ?, capabilities_json = ?, status_json = ?, updated_at = ?
          WHERE id = ?
          `,
          [...values, existing.id],
        );
        return Number(existing.id);
      }
      const result = this.storage.run(
        `
        INSERT INTO devices
          (integration_id, inbox_id, external_id, local_device_key, name, device_type, provider, room_id,
           payload_json, secrets_json, capabilities_json, status_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [...values, now],
      );
      return Number(result.lastInsertRowid);
    });
    return this.autoLinkLocalDevice(deviceId) || (this.getDevice(deviceId) as Device);
  }

  createIntegration(request: JsonObject, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      `
      INSERT INTO integrations (type, name, status, config_json, secrets_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [request.type, request.name, status, this.storage.jsonDump(config), this.storage.jsonDump(secrets), now, now],
    );
    return this.getIntegration(Number(result.lastInsertRowid)) as StoredIntegration;
  }

  findIntegrationByConfigValue(providerType: IntegrationType, key: string, value: string): StoredIntegration | null {
    const normalized = value.trim();
    if (!normalized) return null;
    for (const row of this.storage.all<JsonObject>('SELECT * FROM integrations WHERE type = ?', [providerType])) {
      const config = this.storage.jsonLoad<JsonObject>(row.config_json, {});
      if (String(config[key] || '').trim() === normalized) return this.fromIntegrationRow(row);
    }
    return null;
  }

  findLatestIntegrationByType(providerType: IntegrationType): StoredIntegration | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM integrations WHERE type = ? ORDER BY id DESC LIMIT 1', [providerType]);
    return row ? this.fromIntegrationRow(row) : null;
  }

  updateIntegrationConfigAndSecrets(integrationId: number, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration | null {
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

  listIntegrations(): StoredIntegration[] {
    return this.storage.all<JsonObject>('SELECT * FROM integrations ORDER BY id').map((row) => this.fromIntegrationRow(row));
  }

  getIntegration(integrationId: number): StoredIntegration | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM integrations WHERE id = ?', [integrationId]);
    return row ? this.fromIntegrationRow(row) : null;
  }

  updateIntegrationStatus(integrationId: number, status: IntegrationStatus, error?: string | null, lastSyncAt?: string | null): StoredIntegration | null {
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

  deleteIntegration(integrationId: number): boolean {
    return this.storage.run('DELETE FROM integrations WHERE id = ?', [integrationId]).changes > 0;
  }

  publicIntegration(integration: StoredIntegration): Integration {
    const { secrets: _secrets, ...publicValue } = integration;
    return publicValue;
  }

  private updateSmartthingsQueryState(deviceId: number, result: JsonObject): Device | null {
    const current = this.getDevice(deviceId);
    if (!current) return null;
    const now = this.storage.utcNow();
    const rawStatus = isObject(result.rawStatus) ? result.rawStatus : {};
    const status = { ...current.status, ...result.statusSummary, lastSeenAt: now };
    const capabilities = { ...current.capabilities, status: rawStatus };
    const payload = { ...current.payload, status: rawStatus, lastStatus: rawStatus, lastSeenAt: now };
    this.storage.run(
      `
      UPDATE devices
      SET status_json = ?, capabilities_json = ?, payload_json = ?, updated_at = ?
      WHERE id = ?
      `,
      [this.storage.jsonDump(status), this.storage.jsonDump(capabilities), this.storage.jsonDump(payload), now, deviceId],
    );
    this.updateSmartthingsEntitiesRuntimeState(deviceId, status, rawStatus, now);
    return this.getDevice(deviceId);
  }

  private updateMqttRuntimeState(deviceId: number, result: JsonObject): Device | null {
    const current = this.getDevice(deviceId);
    if (!current) return null;
    const now = this.storage.utcNow();
    const dps = isObject(result.dps) ? result.dps : {};
    const currentDps = isObject(current.status.dps) ? current.status.dps : {};
    const mergedDps = { ...stringifyKeys(currentDps), ...stringifyKeys(dps) };
    const rawStatus = isObject(result.rawStatus) ? result.rawStatus : {};
    const summary = isObject(result.statusSummary) ? result.statusSummary : {};
    const status = {
      ...current.status,
      ...summary,
      raw: rawStatus,
      online: summary.online ?? true,
      lastSeenAt: now,
      dps: mergedDps,
    };
    const capabilities = {
      ...current.capabilities,
      status: mergeStatusEntries(current.capabilities.status || [], dps),
    };
    const payload = {
      ...current.payload,
      status: rawStatus,
      lastStatus: mergedDps,
      lastSeenAt: now,
    };
    this.storage.run(
      `
      UPDATE devices
      SET status_json = ?, capabilities_json = ?, payload_json = ?, updated_at = ?
      WHERE id = ?
      `,
      [this.storage.jsonDump(status), this.storage.jsonDump(capabilities), this.storage.jsonDump(payload), now, deviceId],
    );
    this.updateEntitiesRuntimeState(deviceId, mergedDps, now);
    return this.getDevice(deviceId);
  }

  private updateEntitiesRuntimeState(deviceId: number, dps: JsonObject, now: string): void {
    const rows = this.storage.all<JsonObject>('SELECT * FROM entities WHERE device_id = ?', [deviceId]);
    for (const row of rows) {
      const commandSchema = this.storage.jsonLoad<JsonObject>(row.command_schema_json, {});
      const key = String(commandSchema.switchCode || String(row.unique_key).split(':').at(-1));
      const dpsId = dpsIdFromCode(key);
      const state = this.storage.jsonLoad<JsonObject>(row.state_json, {});
      const currentDps = isObject(state.dps) ? state.dps : {};
      const mergedDps = { ...stringifyKeys(currentDps), ...stringifyKeys(dps) };
      const value = mergedDps[dpsId];
      const capabilities = this.storage.jsonLoad<JsonObject>(row.capabilities_json, {});
      const nextState = {
        ...state,
        value,
        state: stateFromValue(value, row.type),
        online: true,
        lastSeenAt: now,
        dps: mergedDps,
      };
      const nextCapabilities = {
        ...capabilities,
        status: mergeStatusEntries(capabilities.status || [], dps),
      };
      this.storage.run('UPDATE entities SET state_json = ?, capabilities_json = ?, updated_at = ? WHERE id = ?', [
        this.storage.jsonDump(nextState),
        this.storage.jsonDump(nextCapabilities),
        now,
        row.id,
      ]);
    }
  }

  private updateSmartthingsEntitiesRuntimeState(deviceId: number, status: JsonObject, rawStatus: JsonObject, now: string): void {
    const rows = this.storage.all<JsonObject>('SELECT * FROM entities WHERE device_id = ?', [deviceId]);
    for (const row of rows) {
      const state = this.storage.jsonLoad<JsonObject>(row.state_json, {});
      const capabilities = this.storage.jsonLoad<JsonObject>(row.capabilities_json, {});
      this.storage.run('UPDATE entities SET state_json = ?, capabilities_json = ?, updated_at = ? WHERE id = ?', [
        this.storage.jsonDump({ ...state, ...status, lastSeenAt: now }),
        this.storage.jsonDump({ ...capabilities, status: rawStatus }),
        now,
        row.id,
      ]);
    }
  }

  private hasAcceptedOrAddedInboxDevice(device: InboxDevice): boolean {
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

  private findLocalMatch(device: Device, _secrets: JsonObject): JsonObject | null {
    const discoveries: JsonObject[] = this.storage.all<JsonObject>('SELECT device_key, payload_json FROM discovery_devices ORDER BY last_seen_at DESC, id DESC').map((row) => {
      const payload = this.storage.jsonLoad<JsonObject>(row.payload_json, {});
      return { ...payload, deviceKey: row.device_key };
    });
    const targetIp = privateIp(firstNonEmpty(nested(device.payload, 'payload', 'raw', 'last_ip'), nested(device.payload, 'payload', 'raw', 'ip'), device.payload.ip));
    const targetMac = String(firstNonEmpty(device.payload.mac, nested(device.payload, 'payload', 'raw', 'mac')) || '').toUpperCase();
    for (const discovery of discoveries) {
      if (targetIp && discovery.ip === targetIp) return localPayload(device, discovery, 'ip', this.storage.utcNow());
      if (targetMac && String(discovery.mac || '').toUpperCase() === targetMac) return localPayload(device, discovery, 'mac', this.storage.utcNow());
    }
    return null;
  }

  private fromDeviceRow(row: JsonObject): Device {
    return {
      id: row.id,
      integrationId: row.integration_id,
      inboxId: row.inbox_id,
      externalId: row.external_id,
      localDeviceKey: row.local_device_key,
      name: row.name,
      deviceType: row.device_type,
      provider: row.provider,
      roomId: row.room_id,
      roomName: row.room_name,
      payload: this.storage.jsonLoad(row.payload_json, {}),
      capabilities: this.storage.jsonLoad(row.capabilities_json, {}),
      status: this.storage.jsonLoad(row.status_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private fromEntityRow(row: JsonObject): Entity {
    return {
      id: row.id,
      deviceId: row.device_id,
      uniqueKey: row.unique_key,
      type: row.type,
      name: row.name,
      commandSchema: this.storage.jsonLoad(row.command_schema_json, {}),
      state: this.storage.jsonLoad(row.state_json, {}),
      capabilities: this.storage.jsonLoad(row.capabilities_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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

function fromRoomRow(row: JsonObject): Room {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function has(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyKeys(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), item]));
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

function mergeStatusEntries(current: unknown, dps: JsonObject): JsonObject[] {
  const merged: JsonObject = {};
  if (Array.isArray(current)) {
    for (const item of current) {
      if (item && typeof item === 'object' && item.code) merged[String(item.code)] = item.value;
    }
  }
  for (const [dpsId, value] of Object.entries(dps)) {
    merged[codeFromDpsId(String(dpsId))] = value;
  }
  return Object.entries(merged).map(([code, value]) => ({ code, value }));
}

function primaryDpsId(device: Device): string {
  return dpsIdFromCode(String(device.capabilities.primarySwitchCode || device.payload.primarySwitchCode || '1'));
}

export function dpsIdFromCode(code: string): string {
  if (code.startsWith('switch_') && /^\d+$/.test(code.replace('switch_', ''))) return code.replace('switch_', '');
  if (code === 'switch' || code === 'switch_led') return '1';
  return code;
}

function codeFromDpsId(dpsId: string): string {
  return /^\d+$/.test(dpsId) ? `switch_${dpsId}` : dpsId;
}

function stateFromValue(value: unknown, deviceType: string): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (deviceType === 'cover' && typeof value === 'number') {
    if (value <= 2) return 'open';
    if (value >= 98) return 'closed';
    return 'stopped';
  }
  if (deviceType === 'cover' && ['open', 'opened'].includes(String(value).toLowerCase())) return 'open';
  if (deviceType === 'cover' && ['close', 'closed'].includes(String(value).toLowerCase())) return 'closed';
  if (['opening', 'closing', 'moving'].includes(String(value))) return 'on';
  if (['stop', 'stopped', 'idle'].includes(String(value))) return 'idle';
  if (value === null || value === undefined) return ['sensor', 'camera'].includes(deviceType) ? 'idle' : 'unknown';
  return 'unknown';
}

function redactSecrets(value: any): any {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['accesssecret', 'localkey', 'token', 'secret', 'password'].includes(key.toLowerCase()) ? '***' : redactSecrets(item),
      ]),
    );
  }
  return value;
}

function localPayload(device: Device, discovery: JsonObject, matchMethod: string, matchedAt: string): JsonObject {
  const local: JsonObject = {
    ip: discovery.ip,
    mac: discovery.mac,
    source: 'discovery',
    matchMethod,
    discoveryDeviceKey: discovery.deviceKey,
    matchedAt,
  };
  if (['tuya_cloud', 'tuya_local', 'intelbras_izy_tuya'].includes(device.provider)) {
    local.deviceId = device.externalId;
    local.cid = tuyaCid(device);
    local.port = 6668;
    local.primaryDpsId = tuyaPrimaryDpsId(device);
    local.version = '3.4';
  }
  return Object.fromEntries(Object.entries(local).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function tuyaCid(device: Device): string | null {
  const raw = nested(device.payload, 'payload', 'raw') || {};
  return firstNonEmpty(nested(device.payload, 'local', 'cid'), raw.node_id, raw.sub === true ? raw.uuid : null);
}

function tuyaPrimaryDpsId(device: Device): string {
  return dpsIdFromCode(String(firstNonEmpty(nested(device.payload, 'local', 'primaryDpsId'), device.capabilities.primarySwitchCode, device.payload.primarySwitchCode) || '1'));
}

function privateIp(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(text)) return text;
  return null;
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
