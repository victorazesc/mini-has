import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CommandsService } from '../../infrastructure/commands/commands.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { CommandRequest, CommandResult, Device, DeviceEventLevel, DeviceHistoryEntry, InboxDevice, JsonObject } from '../../types';
import { dpsIdFromCode } from './device.utils';

export const DEVICE_SERVICE = 'DEVICE_SERVICE';

type AutomationRunner = {
    triggerAutomationsForEvent(event: AutomationSourceEvent): Promise<void>;
};

@Injectable()
export class DeviceService {
    constructor(
        private readonly storage: StorageService,
        private readonly commands: CommandsService,
        private readonly moduleRef: ModuleRef,
    ) { }

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

    listDeviceHistory(deviceId: number, limit = 40): DeviceHistoryEntry[] {
        const safeLimit = Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 40));
        const events = this.storage
            .all<JsonObject>('SELECT * FROM device_events WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [deviceId, safeLimit])
            .map((row) => this.fromDeviceEventRow(row));
        const commands = this.storage
            .all<JsonObject>('SELECT * FROM device_command_logs WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [deviceId, safeLimit])
            .map((row) => this.fromDeviceHistoryCommandRow(row))
            .filter((entry) => !shouldHideHistoryCommand(entry.command));
        const entityCommands = this.storage
            .all<JsonObject>(
                `
        SELECT command_logs.*, entities.id AS entity_id, entities.name AS entity_name, entities.type AS entity_type, entities.unique_key AS entity_unique_key
        FROM command_logs
        INNER JOIN entities ON entities.id = command_logs.entity_id
        WHERE entities.device_id = ?
        ORDER BY command_logs.created_at DESC, command_logs.id DESC
        LIMIT ?
        `,
                [deviceId, safeLimit],
            )
            .map((row) => this.fromEntityHistoryCommandRow(row))
            .filter((entry) => !shouldHideHistoryCommand(entry.command));

        return [...events, ...commands, ...entityCommands]
            .sort((left, right) => {
                const dateCompare = String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
                if (dateCompare !== 0) return dateCompare;
                return String(right.id).localeCompare(String(left.id));
            })
            .slice(0, safeLimit);
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
        const device = this.getDevice(Number(result.lastInsertRowid)) as Device;
        this.recordDeviceEvent(device.id, 'created', 'Dispositivo criado', 'Cadastro manual concluido.', 'success', {
            provider: device.provider,
            deviceType: device.deviceType,
            roomId: device.roomId,
        });
        return device;
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
        const updated = this.getDevice(deviceId);
        if (updated) {
            const changedFields = Object.keys(request).filter((key) => has(request, key));
            this.recordDeviceEvent(deviceId, 'updated', 'Dispositivo atualizado', `Campos alterados: ${changedFields.map(deviceFieldLabel).join(', ') || 'dados do dispositivo'}.`, 'info', {
                changedFields,
            });
        }
        return updated;
    }

    deleteDevice(deviceId: number): boolean {
        return this.storage.transaction(() => this.deleteDeviceGraph(deviceId));
    }

    deleteDevicesForIntegration(integrationId: number): number[] {
        const rows = this.storage.all<{ id: number; inbox_id: number | null }>(
            'SELECT id, inbox_id FROM devices WHERE integration_id = ?',
            [integrationId],
        );

        for (const row of rows) {
            this.deleteDeviceGraph(Number(row.id));
        }

        return Array.from(
            new Set(
                rows
                    .map((row) => (typeof row.inbox_id === 'number' ? row.inbox_id : null))
                    .filter((inboxId): inboxId is number => inboxId !== null),
            ),
        );
    }

    linkLocalDevice(deviceId: number, body: JsonObject): Device | null {
        const localDeviceKey = String(body.localDeviceKey || '').trim();
        const payload = isObject(body.payload) ? body.payload : {};
        const device = this.getDevice(deviceId);
        if (!device) return null;
        const previousLocalDeviceKey = device.localDeviceKey;
        const nextPayload = { ...device.payload, local: payload, localDeviceKey };
        this.storage.run('UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
            localDeviceKey,
            this.storage.jsonDump(nextPayload),
            this.storage.utcNow(),
            deviceId,
        ]);
        const updated = this.getDevice(deviceId);
        if (updated && previousLocalDeviceKey !== localDeviceKey) {
            this.recordDeviceEvent(deviceId, 'linked_local', 'Vinculo local atualizado', firstNonEmpty(payload.ip, payload.host)
                ? `Dispositivo associado ao endpoint local ${firstNonEmpty(payload.ip, payload.host)}.`
                : 'Dispositivo associado a um endpoint local.', 'success', {
                localDeviceKey,
                ip: firstNonEmpty(payload.ip, payload.host),
                matchBy: payload.matchBy,
            });
        }
        return updated;
    }

    autoLinkLocalDevice(deviceId: number): Device | null {
        const item = this.getDeviceWithSecrets(deviceId);
        if (!item) return null;
        const local = this.findLocalMatch(item.device, item.secrets);
        if (!local) return item.device;
        const localDeviceKey = `local:${local.ip}:${item.device.externalId}`;
        const previousLocalDeviceKey = item.device.localDeviceKey;
        const nextPayload = { ...item.device.payload, local, localDeviceKey };
        this.storage.run('UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
            localDeviceKey,
            this.storage.jsonDump(nextPayload),
            this.storage.utcNow(),
            deviceId,
        ]);
        const updated = this.getDevice(deviceId);
        if (updated && previousLocalDeviceKey !== localDeviceKey) {
            this.recordDeviceEvent(deviceId, 'auto_linked_local', 'Vinculo local encontrado', local.ip ? `Associado automaticamente ao IP ${local.ip}.` : 'Associado automaticamente a um endpoint local.', 'success', {
                localDeviceKey,
                ip: local.ip,
                matchBy: local.matchBy,
            });
        }
        return updated;
    }

    autoLinkLocalDevices(): Device[] {
        return this.listDevices().map((device) => this.autoLinkLocalDevice(device.id)).filter(Boolean) as Device[];
    }

    async commandDevice(deviceId: number, body: CommandRequest) {
        const item = this.getDeviceWithSecrets(deviceId);
        if (!item) return null;

        const request = { command: body.command, params: body.params || {} };
        const result = await this.commands.executeDeviceCommand(item.device, item.secrets, request);
        this.updateDeviceRuntimeState(deviceId, result);
        this.logDeviceCommand(deviceId, request, result);
        return result;
    }

    updateDeviceRuntimeState(deviceId: number, commandResult: CommandResult): Device | null {
        if (!commandResult.ok) return this.getDevice(deviceId);
        if (commandResult.result.provider === 'smartthings_cloud' && commandResult.result.action === 'query' && isObject(commandResult.result.statusSummary)) {
            return this.updateSmartthingsQueryState(deviceId, commandResult);
        }
        if (commandResult.result.provider === 'mqtt' && isObject(commandResult.result.statusSummary)) {
            return this.updateMqttRuntimeState(deviceId, commandResult);
        }
        if (commandResult.result.provider === 'intelbras_amt8000' && isObject(commandResult.result.statusSummary)) {
            return this.updateAmt8000RuntimeState(deviceId, commandResult);
        }
        const dps = commandResult.result.dps;
        if (!isObject(dps) || !Object.keys(dps).length) return this.getDevice(deviceId);
        const current = this.getDevice(deviceId);
        if (!current) return null;

        const now = this.storage.utcNow();
        const eventSource = eventSourceFromCommandResult(commandResult);
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
        this.updateEntitiesRuntimeState(deviceId, mergedDps, now, eventSource || {});
        this.logRuntimeStatusEvent(deviceId, current.status, status, { dps, ...(eventSource || {}) });
        return this.getDevice(deviceId);
    }

    logDeviceCommand(deviceId: number, request: CommandRequest, result: CommandResult, metadata: JsonObject = {}): void {
        const source = Object.keys(metadata).length ? { type: 'scene', ...redactSecrets(metadata) } : null;
        const commandToStore = source ? { ...redactSecrets(request), source } : redactSecrets(request);
        const resultToStore = source
            ? { ...result, result: { ...result.result, source } }
            : result;
        this.storage.run(
            `
      INSERT INTO device_command_logs (device_id, command_json, result_json, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
            [deviceId, this.storage.jsonDump(commandToStore), this.storage.jsonDump(resultToStore), result.status, this.storage.utcNow()],
        );
    }

    acceptInboxDevice(inbox: InboxDevice, secrets: JsonObject, name?: string | null, roomId?: number | null): Device {
        const payload = inbox.payload;
        const now = this.storage.utcNow();
        const provider = String(payload.provider || inbox.sourceType);
        const externalId = String(payload.externalId || inbox.externalId);
        let existed = false;
        const deviceId = this.storage.transaction(() => {
            const existing = this.storage.get<JsonObject>('SELECT id FROM devices WHERE provider = ? AND external_id = ?', [provider, externalId]);
            existed = Boolean(existing);
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
        const device = this.autoLinkLocalDevice(deviceId) || (this.getDevice(deviceId) as Device);
        this.recordDeviceEvent(
            deviceId,
            existed ? 'synced_from_inbox' : 'imported_from_inbox',
            existed ? 'Dispositivo sincronizado' : 'Dispositivo importado',
            existed
                ? 'Os dados do dispositivo foram atualizados a partir da caixa de entrada.'
                : 'Dispositivo adicionado ao Mini HAS a partir da caixa de entrada.',
            'success',
            {
                inboxId: inbox.id,
                sourceType: inbox.sourceType,
                sourceId: inbox.sourceId,
                provider,
                roomId: roomId ?? null,
            },
        );
        return device;
    }

    private updateAmt8000RuntimeState(deviceId: number, commandResult: CommandResult): Device | null {
        const current = this.getDevice(deviceId);
        if (!current) return null;
        const now = this.storage.utcNow();
        const summary = commandResult.result.statusSummary as JsonObject;
        const status = { ...current.status, ...summary, lastSeenAt: now };
        this.storage.run('UPDATE devices SET status_json = ?, updated_at = ? WHERE id = ?', [
            this.storage.jsonDump(status),
            now,
            deviceId,
        ]);
        this.logRuntimeStatusEvent(deviceId, current.status, status, { provider: 'intelbras_amt8000', action: commandResult.result.action });
        return this.getDevice(deviceId);
    }

    private updateSmartthingsQueryState(deviceId: number, commandResult: CommandResult): Device | null {
        const current = this.getDevice(deviceId);
        if (!current) return null;
        const now = this.storage.utcNow();
        const result = isObject(commandResult.result) ? commandResult.result : {};
        const eventSource = eventSourceFromCommandResult(commandResult);
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
        this.updateSmartthingsEntitiesRuntimeState(deviceId, status, rawStatus, now, eventSource || {});
        this.logRuntimeStatusEvent(deviceId, current.status, status, { provider: 'smartthings_cloud', ...(eventSource || {}) });
        return this.getDevice(deviceId);
    }

    private updateMqttRuntimeState(deviceId: number, commandResult: CommandResult): Device | null {
        const current = this.getDevice(deviceId);
        if (!current) return null;
        const now = this.storage.utcNow();
        const result = isObject(commandResult.result) ? commandResult.result : {};
        const eventSource = eventSourceFromCommandResult(commandResult);
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
        this.updateEntitiesRuntimeState(deviceId, mergedDps, now, eventSource || {});
        this.logRuntimeStatusEvent(deviceId, current.status, status, { provider: 'mqtt', ...(eventSource || {}) });
        return this.getDevice(deviceId);
    }

    private recordDeviceEvent(
        deviceId: number,
        eventType: string,
        title: string,
        message: string | null,
        level: DeviceEventLevel = 'info',
        payload: JsonObject = {},
    ): void {
        const createdAt = this.storage.utcNow();
        const safePayload = redactSecrets(payload);
        const result = this.storage.run(
            `
      INSERT INTO device_events (device_id, event_type, title, message, level, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
            [deviceId, eventType, title, message, level, this.storage.jsonDump(safePayload), createdAt],
        );

        const event: AutomationSourceEvent = {
            id: Number(result.lastInsertRowid),
            deviceId,
            eventType,
            title,
            message,
            level,
            payload: safePayload,
            createdAt,
        };

        if (event.id > 0) {
            this.triggerAutomationsForEvent(event);
        }
    }

    private triggerAutomationsForEvent(event: AutomationSourceEvent): void {
        try {
            const automations = this.moduleRef.get<AutomationRunner>('AUTOMATION_SERVICE', { strict: false });
            void automations.triggerAutomationsForEvent(event).catch((error) => {
                console.error('automation-runner-error', error);
            });
        } catch (error) {
            console.error('automation-runner-unavailable', error);
        }
    }

    private logRuntimeStatusEvent(deviceId: number, previousStatus: JsonObject, nextStatus: JsonObject, payload: JsonObject = {}): void {
        const previousState = String(previousStatus.state || '').trim();
        const nextState = String(nextStatus.state || '').trim();
        const previousOnline = previousStatus.online === undefined ? null : Boolean(previousStatus.online);
        const nextOnline = nextStatus.online === undefined ? null : Boolean(nextStatus.online);
        const hadPreviousSnapshot = Boolean(previousStatus.lastSeenAt) || (isObject(previousStatus.dps) && Object.keys(previousStatus.dps).length > 0);

        if (!hadPreviousSnapshot && (nextState || nextOnline !== null)) {
            this.recordDeviceEvent(
                deviceId,
                'status_initialized',
                'Primeiro status recebido',
                runtimeStatusMessage(nextOnline, nextState),
                nextOnline === false ? 'warning' : 'success',
                payload,
            );
            return;
        }

        if (previousOnline !== null && nextOnline !== null && previousOnline !== nextOnline) {
            this.recordDeviceEvent(
                deviceId,
                nextOnline ? 'became_online' : 'became_offline',
                nextOnline ? 'Dispositivo ficou online' : 'Dispositivo ficou offline',
                runtimeStatusMessage(nextOnline, nextState),
                nextOnline ? 'success' : 'warning',
                payload,
            );
            return;
        }

        if (nextState && previousState !== nextState) {
            this.recordDeviceEvent(
                deviceId,
                'state_changed',
                'Estado alterado',
                `${deviceStateLabel(previousState) || 'Sem estado'} -> ${deviceStateLabel(nextState)}`,
                nextOnline === false ? 'warning' : 'info',
                { ...payload, previousState, nextState },
            );
        }
    }

    private updateEntitiesRuntimeState(deviceId: number, dps: JsonObject, now: string, payload: JsonObject = {}): void {
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
            this.logEntityRuntimeStatusEvent(deviceId, row, state, nextState, { dpsId, key, ...payload });
        }
    }

    private updateSmartthingsEntitiesRuntimeState(deviceId: number, status: JsonObject, rawStatus: JsonObject, now: string, payload: JsonObject = {}): void {
        const rows = this.storage.all<JsonObject>('SELECT * FROM entities WHERE device_id = ?', [deviceId]);
        for (const row of rows) {
            const state = this.storage.jsonLoad<JsonObject>(row.state_json, {});
            const nextState = { ...state, ...status, lastSeenAt: now };
            const capabilities = this.storage.jsonLoad<JsonObject>(row.capabilities_json, {});
            this.storage.run('UPDATE entities SET state_json = ?, capabilities_json = ?, updated_at = ? WHERE id = ?', [
                this.storage.jsonDump(nextState),
                this.storage.jsonDump({ ...capabilities, status: rawStatus }),
                now,
                row.id,
            ]);
            this.logEntityRuntimeStatusEvent(deviceId, row, state, nextState, { provider: 'smartthings_cloud', ...payload });
        }
    }

    private logEntityRuntimeStatusEvent(deviceId: number, row: JsonObject, previousState: JsonObject, nextState: JsonObject, payload: JsonObject = {}): void {
        const previousStateValue = String(previousState.state || '').trim();
        const nextStateValue = String(nextState.state || '').trim();
        const previousValue = has(previousState, 'value') ? previousState.value : undefined;
        const nextValue = has(nextState, 'value') ? nextState.value : undefined;
        const previousOnline = previousState.online === undefined ? null : Boolean(previousState.online);
        const nextOnline = nextState.online === undefined ? null : Boolean(nextState.online);
        const hadPreviousSnapshot = Boolean(previousState.lastSeenAt) || previousStateValue !== '' || previousValue !== undefined || (isObject(previousState.dps) && Object.keys(previousState.dps).length > 0);
        const basePayload = {
            scope: 'entity',
            entityId: row.id,
            entityName: row.name,
            entityType: row.type,
            uniqueKey: row.unique_key,
            ...payload,
        };

        if (!hadPreviousSnapshot && (nextStateValue !== '' || nextValue !== undefined || nextOnline !== null)) {
            this.recordDeviceEvent(
                deviceId,
                'entity_status_initialized',
                `${row.name} recebeu status`,
                entityRuntimeStatusMessage(nextOnline, nextStateValue, nextValue),
                nextOnline === false ? 'warning' : 'success',
                basePayload,
            );
            return;
        }

        if (previousOnline !== null && nextOnline !== null && previousOnline !== nextOnline) {
            this.recordDeviceEvent(
                deviceId,
                nextOnline ? 'entity_became_online' : 'entity_became_offline',
                nextOnline ? `${row.name} ficou online` : `${row.name} ficou offline`,
                entityRuntimeStatusMessage(nextOnline, nextStateValue, nextValue),
                nextOnline ? 'success' : 'warning',
                basePayload,
            );
            return;
        }

        if (previousStateValue !== nextStateValue || !historyValuesEqual(previousValue, nextValue)) {
            this.recordDeviceEvent(
                deviceId,
                'entity_state_changed',
                `${row.name} alterou estado`,
                entityStateChangeMessage(previousStateValue, nextStateValue, previousValue, nextValue),
                nextOnline === false ? 'warning' : 'info',
                { ...basePayload, previousState: previousStateValue || null, nextState: nextStateValue || null, previousValue, nextValue },
            );
        }
    }

    private deleteDeviceGraph(deviceId: number): boolean {
        const entityIds = this.storage
            .all<{ id: number }>('SELECT id FROM entities WHERE device_id = ?', [deviceId])
            .map((row) => Number(row.id));

        if (entityIds.length) {
            const placeholders = entityIds.map(() => '?').join(', ');
            this.storage.run(`DELETE FROM command_logs WHERE entity_id IN (${placeholders})`, entityIds);
            this.storage.run('DELETE FROM entities WHERE device_id = ?', [deviceId]);
        }

        this.storage.run('DELETE FROM device_command_logs WHERE device_id = ?', [deviceId]);
        this.storage.run('DELETE FROM device_events WHERE device_id = ?', [deviceId]);
        return this.storage.run('DELETE FROM devices WHERE id = ?', [deviceId]).changes > 0;
    }

    private findLocalMatch(device: Device, _secrets: JsonObject): JsonObject | null {
        const discoveries: JsonObject[] = this.storage.all<JsonObject>('SELECT device_key, payload_json FROM discovery_devices ORDER BY last_seen_at DESC, id DESC').map((row) => {
            const payload = this.storage.jsonLoad<JsonObject>(row.payload_json, {});
            return { ...payload, deviceKey: row.device_key };
        });
        const targetIp = privateIp(firstNonEmpty(nested(device.payload, 'payload', 'raw', 'last_ip'), nested(device.payload, 'payload', 'raw', 'ip'), device.payload.ip));
        const targetMac = String(firstNonEmpty(device.payload.mac, nested(device.payload, 'local', 'mac'), nested(device.payload, 'payload', 'raw', 'mac')) || '').toUpperCase();
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

    private fromDeviceEventRow(row: JsonObject): DeviceHistoryEntry {
        const event = this.storage.jsonLoad<JsonObject>(row.payload_json, {});
        return {
            id: `event:${row.id}`,
            kind: 'event',
            deviceId: row.device_id,
            eventType: row.event_type,
            title: row.title,
            message: row.message,
            level: row.level || 'info',
            payload: event,
            createdAt: row.created_at,
        };
    }

    private fromDeviceHistoryCommandRow(row: JsonObject): DeviceHistoryEntry {
        const command = this.storage.jsonLoad<JsonObject>(row.command_json, {});
        const result = this.storage.jsonLoad<JsonObject>(row.result_json, {});
        const sceneSource = sceneSourceFromCommandResult(command, result);
        return {
            id: `command:${row.id}`,
            kind: 'command',
            deviceId: row.device_id,
            eventType: 'device_command',
            title: deviceCommandTitle(command),
            message: String(result.message || summarizeCommandParams(command.params) || ''),
            status: row.status,
            level: commandLevelFromStatus(String(row.status || result.status || '')),
            command,
            result,
            payload: sceneSource ? { scope: 'device', ...sceneSource } : { scope: 'device' },
            createdAt: row.created_at,
        };
    }

    private fromEntityHistoryCommandRow(row: JsonObject): DeviceHistoryEntry {
        const command = this.storage.jsonLoad<JsonObject>(row.command_json, {});
        const result = this.storage.jsonLoad<JsonObject>(row.result_json, {});
        return {
            id: `entity-command:${row.id}`,
            kind: 'command',
            deviceId: Number(result.result?.deviceId || 0),
            eventType: 'entity_command',
            title: `${row.entity_name}: ${deviceCommandTitle(command)}`,
            message: String(result.message || summarizeCommandParams(command.params) || ''),
            status: row.status,
            level: commandLevelFromStatus(String(row.status || result.status || '')),
            command,
            result,
            payload: {
                scope: 'entity',
                entityId: row.entity_id,
                entityName: row.entity_name,
                entityType: row.entity_type,
                uniqueKey: row.entity_unique_key,
            },
            createdAt: row.created_at,
        };
    }
}

type AutomationSourceEvent = {
    id: number;
    deviceId: number;
    eventType: string;
    title: string;
    message: string | null;
    level: DeviceEventLevel;
    payload: JsonObject;
    createdAt: string;
};

function sceneSourceFromCommandResult(command: JsonObject, result: JsonObject): JsonObject | null {
    const resultPayload = isObject(result.result) ? result.result : null;
    const source = isObject(command.source)
        ? command.source
        : resultPayload && isObject(resultPayload.source)
            ? resultPayload.source
            : resultPayload && isObject(resultPayload.scene)
                ? resultPayload.scene
                : null;

    if (!source || String(source.type || 'scene') !== 'scene') return null;

    return {
        sourceType: 'scene',
        sceneId: Number.isInteger(Number(source.sceneId)) ? Number(source.sceneId) : null,
        sceneName: source.sceneName ? String(source.sceneName) : null,
        actionId: Number.isInteger(Number(source.actionId)) ? Number(source.actionId) : null,
        orderIndex: Number.isInteger(Number(source.orderIndex)) ? Number(source.orderIndex) : null,
        automationId: Number.isInteger(Number(source.automationId)) ? Number(source.automationId) : null,
        automationName: source.automationName ? String(source.automationName) : null,
    };
}

function eventSourceFromCommandResult(commandResult: CommandResult): JsonObject | null {
    const payload = isObject(commandResult.result) ? commandResult.result : null;
    const source = payload && isObject(payload.source)
        ? payload.source
        : payload && isObject(payload.scene)
            ? payload.scene
            : null;

    if (!source || String(source.type || 'scene') !== 'scene') return null;

    return {
        sourceType: 'scene',
        sceneId: Number.isInteger(Number(source.sceneId)) ? Number(source.sceneId) : null,
        sceneName: source.sceneName ? String(source.sceneName) : null,
        actionId: Number.isInteger(Number(source.actionId)) ? Number(source.actionId) : null,
        orderIndex: Number.isInteger(Number(source.orderIndex)) ? Number(source.orderIndex) : null,
        automationId: Number.isInteger(Number(source.automationId)) ? Number(source.automationId) : null,
        automationName: source.automationName ? String(source.automationName) : null,
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

function deviceFieldLabel(field: string): string {
    if (field === 'name') return 'nome';
    if (field === 'deviceType') return 'tipo';
    if (field === 'roomId') return 'cômodo';
    if (field === 'localDeviceKey') return 'vínculo local';
    if (field === 'payload') return 'payload';
    if (field === 'capabilities') return 'capacidades';
    if (field === 'status') return 'status';
    return field;
}

function deviceStateLabel(state: string): string {
    const normalized = String(state || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'on') return 'ligado';
    if (normalized === 'off') return 'desligado';
    if (normalized === 'open') return 'aberto';
    if (normalized === 'closed') return 'fechado';
    if (normalized === 'opening') return 'abrindo';
    if (normalized === 'closing') return 'fechando';
    if (normalized === 'idle') return 'parado';
    return normalized;
}

function runtimeStatusMessage(isOnline: boolean | null, state: string): string | null {
    const parts = [
        isOnline === null ? '' : isOnline ? 'online' : 'offline',
        deviceStateLabel(state),
    ].filter(Boolean);
    return parts.length ? `Status atual: ${parts.join(' • ')}.` : null;
}

function entityRuntimeStatusMessage(isOnline: boolean | null, state: string, value: unknown): string | null {
    const parts = [
        isOnline === null ? '' : isOnline ? 'online' : 'offline',
        deviceStateLabel(state),
        historyValueLabel(value),
    ].filter(Boolean);
    return parts.length ? `Status atual: ${parts.join(' • ')}.` : null;
}

function entityStateChangeMessage(previousState: string, nextState: string, previousValue: unknown, nextValue: unknown): string {
    if (previousState !== nextState) {
        return `${deviceStateLabel(previousState) || 'Sem estado'} -> ${deviceStateLabel(nextState) || 'Sem estado'}`;
    }

    return `${historyValueLabel(previousValue) || 'Sem valor'} -> ${historyValueLabel(nextValue) || 'Sem valor'}`;
}

function historyValuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function historyValueLabel(value: unknown): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'ativo' : 'inativo';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function deviceCommandTitle(command: JsonObject): string {
    const name = String(command.command || '').trim().toLowerCase();
    if (!name) return 'Comando executado';
    if (name === 'turn_on') return 'Comando para ligar';
    if (name === 'turn_off') return 'Comando para desligar';
    if (name === 'toggle') return 'Comando de alternância';
    if (name === 'query') return 'Consulta de status';
    if (name === 'set') return 'Comando de ajuste';
    if (name === 'open') return 'Comando para abrir';
    if (name === 'close') return 'Comando para fechar';
    if (name === 'stop') return 'Comando para parar';
    return `Comando ${name}`;
}

function shouldHideHistoryCommand(command: JsonObject | null | undefined): boolean {
    return String(command?.command || '').trim().toLowerCase() === 'query';
}

function summarizeCommandParams(params: unknown): string | null {
    if (!isObject(params)) return null;
    const entries = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(redactSecrets(value)) : String(value)}`);
    return entries.length ? entries.join(' • ') : null;
}

function commandLevelFromStatus(status: string): DeviceEventLevel {
    const normalized = String(status || '').trim().toLowerCase();
    if (['error', 'failed', 'failure', 'unsupported'].includes(normalized)) return 'error';
    if (['warning', 'timeout'].includes(normalized)) return 'warning';
    if (['sent', 'ok', 'accepted'].includes(normalized)) return 'success';
    return 'info';
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
