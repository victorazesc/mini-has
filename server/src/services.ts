import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  Automation,
  AutomationRun,
  AutomationTrigger,
  AutomationTriggerType,
  CommandRequest,
  CommandResult,
  Device,
  DeviceEvent,
  DeviceEventLevel,
  DeviceHistoryEntry,
  Entity,
  InboxDevice,
  InboxStatus,
  Integration,
  IntegrationStatus,
  IntegrationType,
  JsonObject,
  ProviderEntity,
  Room,
  Scene,
  SceneAction,
  SceneRun,
  SceneRunStatus,
  StoredIntegration,
} from './types';
import { CommandsService } from './commands';
import { StorageService } from './storage';

const SCENE_ALLOWED_COMMANDS = new Set([
  'turn_on',
  'turn_off',
  'open',
  'close',
  'stop',
  'set_position',
  'arm',
  'disarm',
  'arm_partition',
  'disarm_partition',
]);
const AUTOMATION_ALLOWED_TRIGGER_TYPES = new Set<AutomationTriggerType>(['device_state_changed', 'entity_state_changed']);

@Injectable()
export class HomeService {
  constructor(
    private readonly storage: StorageService,
    @Inject(forwardRef(() => CommandsService))
    private readonly commands: CommandsService,
  ) { }

  listRooms(): Room[] {
    const rows = this.storage.all<JsonObject>(`
      SELECT rooms.*, floors.name AS floor_name,
             (SELECT COUNT(*) FROM devices WHERE devices.room_id = rooms.id) AS devices_count
      FROM rooms
      LEFT JOIN floors ON floors.id = rooms.floor_id
      ORDER BY COALESCE(floors.name, ''), rooms.name
    `);
    return rows.map(fromRoomRow);
  }

  getRoom(roomId: number): Room | null {
    const row = this.storage.get<JsonObject>(`
      SELECT rooms.*, floors.name AS floor_name,
             (SELECT COUNT(*) FROM devices WHERE devices.room_id = rooms.id) AS devices_count
      FROM rooms
      LEFT JOIN floors ON floors.id = rooms.floor_id
      WHERE rooms.id = ?
    `, [roomId]);
    return row ? fromRoomRow(row) : null;
  }

  createRoom(request: JsonObject): Room {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      'INSERT INTO rooms (name, icon, floor_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [request.name, request.icon, request.floorId, request.description, now, now],
    );
    return this.getRoom(Number(result.lastInsertRowid)) as Room;
  }

  updateRoom(roomId: number, request: JsonObject): Room | null {
    const current = this.getRoom(roomId);

    if (!current) return null;

    const fieldMap: Record<string, string> = {
      name: 'name',
      icon: 'icon',
      floorId: 'floor_id',
      floor_id: 'floor_id',
      description: 'description',
    };

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
    values.push(this.storage.utcNow());

    values.push(roomId);

    this.storage.run(
      `UPDATE rooms SET ${assignments.join(', ')} WHERE id = ?`,
      values,
    );

    return this.getRoom(roomId);
  }

  deleteRoom(roomId: number): boolean {
    return this.storage.transaction(() => {
      this.storage.run('UPDATE devices SET room_id = NULL WHERE room_id = ?', [roomId]);
      return this.storage.run('DELETE FROM rooms WHERE id = ?', [roomId]).changes > 0;
    });
  }

  listScenes(): Scene[] {
    const rows = this.storage.all<JsonObject>(`
      SELECT scenes.*, rooms.name AS room_name
      FROM scenes
      LEFT JOIN rooms ON rooms.id = scenes.room_id
      ORDER BY COALESCE(rooms.name, ''), scenes.name, scenes.id
    `);
    return rows.map((row) => this.fromSceneRow(row));
  }

  getScene(sceneId: number): Scene | null {
    const row = this.storage.get<JsonObject>(
      `
      SELECT scenes.*, rooms.name AS room_name
      FROM scenes
      LEFT JOIN rooms ON rooms.id = scenes.room_id
      WHERE scenes.id = ?
      `,
      [sceneId],
    );
    return row ? this.fromSceneRow(row) : null;
  }

  createScene(request: JsonObject): Scene {
    const name = String(request.name || '').trim();
    if (!name) throw new Error('Nome da cena e obrigatorio.');

    const roomId = this.normalizeSceneRoomId(request.roomId);
    const actions = this.normalizeSceneActions(request.actions, { requireActions: true });
    const now = this.storage.utcNow();

    const sceneId = this.storage.transaction(() => {
      const result = this.storage.run(
        'INSERT INTO scenes (name, description, room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [name, nullableText(request.description), roomId, now, now],
      );
      this.replaceSceneActions(Number(result.lastInsertRowid), actions, now);
      return Number(result.lastInsertRowid);
    });

    return this.getScene(sceneId) as Scene;
  }

  updateScene(sceneId: number, request: JsonObject): Scene | null {
    const current = this.getScene(sceneId);
    if (!current) return null;

    const assignments: string[] = [];
    const values: unknown[] = [];

    if (has(request, 'name')) {
      const name = String(request.name || '').trim();
      if (!name) throw new Error('Nome da cena e obrigatorio.');
      assignments.push('name = ?');
      values.push(name);
    }

    if (has(request, 'description')) {
      assignments.push('description = ?');
      values.push(nullableText(request.description));
    }

    if (has(request, 'roomId')) {
      assignments.push('room_id = ?');
      values.push(this.normalizeSceneRoomId(request.roomId));
    }

    const shouldReplaceActions = has(request, 'actions');
    const actions = shouldReplaceActions ? this.normalizeSceneActions(request.actions, { requireActions: true }) : [];

    if (!assignments.length && !shouldReplaceActions) return current;

    const now = this.storage.utcNow();
    this.storage.transaction(() => {
      if (assignments.length) {
        assignments.push('updated_at = ?');
        values.push(now, sceneId);
        this.storage.run(`UPDATE scenes SET ${assignments.join(', ')} WHERE id = ?`, values);
      } else {
        this.storage.run('UPDATE scenes SET updated_at = ? WHERE id = ?', [now, sceneId]);
      }

      if (shouldReplaceActions) {
        this.replaceSceneActions(sceneId, actions, now);
      }
    });

    return this.getScene(sceneId);
  }

  deleteScene(sceneId: number): boolean {
    return this.storage.transaction(() => this.storage.run('DELETE FROM scenes WHERE id = ?', [sceneId]).changes > 0);
  }

  async runScene(
    sceneId: number,
    executeCommand: (device: Device, secrets: JsonObject, request: CommandRequest) => Promise<CommandResult>,
    sourceMetadata: JsonObject = {},
  ): Promise<SceneRun | null> {
    const scene = this.getScene(sceneId);
    if (!scene) return null;

    const startedAt = this.storage.utcNow();
    const steps: JsonObject[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const action of scene.actions) {
      const request: CommandRequest = { command: action.command, params: action.params || {} };
      const deviceItem = this.getDeviceWithSecrets(action.deviceId);

      if (!deviceItem) {
        errorCount += 1;
        steps.push({
          actionId: action.id,
          deviceId: action.deviceId,
          deviceName: action.deviceName,
          orderIndex: action.orderIndex,
          command: action.command,
          status: 'error',
          ok: false,
          message: 'Dispositivo da cena nao encontrado.',
          createdAt: this.storage.utcNow(),
        });
        continue;
      }

      const result = await executeCommand(deviceItem.device, deviceItem.secrets, request);
      const enrichedResult = this.enrichSceneCommandResult(result, scene, action, sourceMetadata);
      this.updateDeviceRuntimeState(action.deviceId, enrichedResult);
      this.logDeviceCommand(action.deviceId, request, enrichedResult, {
        sceneId: scene.id,
        sceneName: scene.name,
        actionId: action.id,
        orderIndex: action.orderIndex,
        ...redactSecrets(sourceMetadata),
      });

      if (enrichedResult.ok) {
        successCount += 1;
      } else {
        errorCount += 1;
      }

      steps.push({
        actionId: action.id,
        deviceId: action.deviceId,
        deviceName: action.deviceName,
        orderIndex: action.orderIndex,
        command: action.command,
        params: action.params,
        status: enrichedResult.status,
        ok: enrichedResult.ok,
        message: enrichedResult.message,
        result: enrichedResult.result,
        createdAt: this.storage.utcNow(),
      });
    }

    const status: SceneRunStatus = errorCount === 0 ? 'success' : successCount > 0 ? 'partial' : 'error';
    const summary = {
      sceneId: scene.id,
      sceneName: scene.name,
      totalActions: scene.actions.length,
      successCount,
      errorCount,
      status,
      startedAt,
      finishedAt: this.storage.utcNow(),
      steps,
    };

    const runResult = this.storage.run(
      `
      INSERT INTO scene_runs (scene_id, status, summary_json, created_at)
      VALUES (?, ?, ?, ?)
      `,
      [scene.id, status, this.storage.jsonDump(summary), summary.finishedAt],
    );

    return this.getSceneRun(Number(runResult.lastInsertRowid));
  }

  listSceneRuns(sceneId: number, limit = 10): SceneRun[] {
    const safeLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
    const rows = this.storage.all<JsonObject>(
      'SELECT * FROM scene_runs WHERE scene_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [sceneId, safeLimit],
    );
    return rows.map((row) => fromSceneRunRow(row));
  }

  startSceneRun(sceneId: number, summary: JsonObject = {}): SceneRun {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      'INSERT INTO scene_runs (scene_id, status, summary_json, created_at) VALUES (?, ?, ?, ?)',
      [sceneId, 'pending', this.storage.jsonDump(summary), now],
    );
    return this.getSceneRun(Number(result.lastInsertRowid)) as SceneRun;
  }

  completeSceneRun(sceneRunId: number, status: SceneRunStatus, summary: JsonObject): SceneRun | null {
    this.storage.run('UPDATE scene_runs SET status = ?, summary_json = ? WHERE id = ?', [status, this.storage.jsonDump(summary), sceneRunId]);
    return this.getSceneRun(sceneRunId);
  }

  listAutomationRuns(automationId: number, limit = 10): AutomationRun[] {
    const safeLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
    const rows = this.storage.all<JsonObject>(
      'SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [automationId, safeLimit],
    );
    return rows.map((row) => fromAutomationRunRow(row));
  }

  startAutomationRun(automationId: number, summary: JsonObject = {}): AutomationRun {
    const now = this.storage.utcNow();
    const result = this.storage.run(
      'INSERT INTO automation_runs (automation_id, status, summary_json, created_at) VALUES (?, ?, ?, ?)',
      [automationId, 'pending', this.storage.jsonDump(summary), now],
    );
    return this.getAutomationRun(Number(result.lastInsertRowid)) as AutomationRun;
  }

  completeAutomationRun(automationRunId: number, status: SceneRunStatus, summary: JsonObject): AutomationRun | null {
    this.storage.run('UPDATE automation_runs SET status = ?, summary_json = ? WHERE id = ?', [status, this.storage.jsonDump(summary), automationRunId]);
    return this.getAutomationRun(automationRunId);
  }

  listAutomations(): Automation[] {
    const rows = this.storage.all<JsonObject>(`
      SELECT automations.*, rooms.name AS room_name, scenes.name AS scene_name
      FROM automations
      LEFT JOIN rooms ON rooms.id = automations.room_id
      INNER JOIN scenes ON scenes.id = automations.scene_id
      ORDER BY automations.enabled DESC, COALESCE(rooms.name, ''), automations.name, automations.id
    `);
    return rows.map((row) => this.fromAutomationRow(row));
  }

  getAutomation(automationId: number): Automation | null {
    const row = this.storage.get<JsonObject>(
      `
      SELECT automations.*, rooms.name AS room_name, scenes.name AS scene_name
      FROM automations
      LEFT JOIN rooms ON rooms.id = automations.room_id
      INNER JOIN scenes ON scenes.id = automations.scene_id
      WHERE automations.id = ?
      `,
      [automationId],
    );
    return row ? this.fromAutomationRow(row) : null;
  }

  createAutomation(request: JsonObject): Automation {
    const name = String(request.name || '').trim();
    if (!name) throw new Error('Nome da automacao e obrigatorio.');

    const roomId = this.normalizeAutomationRoomId(request.roomId);
    const sceneId = this.normalizeAutomationSceneId(request.sceneId);
    const enabled = this.normalizeAutomationEnabled(request.enabled, true);
    const trigger = this.normalizeAutomationTrigger(request.trigger);
    const now = this.storage.utcNow();

    const automationId = this.storage.transaction(() => {
      const result = this.storage.run(
        'INSERT INTO automations (name, description, enabled, room_id, scene_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, nullableText(request.description), enabled ? 1 : 0, roomId, sceneId, now, now],
      );
      this.replaceAutomationTrigger(Number(result.lastInsertRowid), trigger, now);
      return Number(result.lastInsertRowid);
    });

    return this.getAutomation(automationId) as Automation;
  }

  updateAutomation(automationId: number, request: JsonObject): Automation | null {
    const current = this.getAutomation(automationId);
    if (!current) return null;

    const assignments: string[] = [];
    const values: unknown[] = [];

    if (has(request, 'name')) {
      const name = String(request.name || '').trim();
      if (!name) throw new Error('Nome da automacao e obrigatorio.');
      assignments.push('name = ?');
      values.push(name);
    }

    if (has(request, 'description')) {
      assignments.push('description = ?');
      values.push(nullableText(request.description));
    }

    if (has(request, 'enabled')) {
      assignments.push('enabled = ?');
      values.push(this.normalizeAutomationEnabled(request.enabled, current.enabled) ? 1 : 0);
    }

    if (has(request, 'roomId')) {
      assignments.push('room_id = ?');
      values.push(this.normalizeAutomationRoomId(request.roomId));
    }

    if (has(request, 'sceneId')) {
      assignments.push('scene_id = ?');
      values.push(this.normalizeAutomationSceneId(request.sceneId));
    }

    const shouldReplaceTrigger = has(request, 'trigger');
    const trigger = shouldReplaceTrigger ? this.normalizeAutomationTrigger(request.trigger) : null;

    if (!assignments.length && !shouldReplaceTrigger) return current;

    const now = this.storage.utcNow();
    this.storage.transaction(() => {
      if (assignments.length) {
        assignments.push('updated_at = ?');
        values.push(now, automationId);
        this.storage.run(`UPDATE automations SET ${assignments.join(', ')} WHERE id = ?`, values);
      } else {
        this.storage.run('UPDATE automations SET updated_at = ? WHERE id = ?', [now, automationId]);
      }

      if (trigger) {
        this.replaceAutomationTrigger(automationId, trigger, now);
      }
    });

    return this.getAutomation(automationId);
  }

  deleteAutomation(automationId: number): boolean {
    return this.storage.transaction(() => this.storage.run('DELETE FROM automations WHERE id = ?', [automationId]).changes > 0);
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
    return this.storage.transaction(() => {
      return this.deleteDeviceGraph(deviceId);
    });
  }

  linkLocalDevice(deviceId: number, localDeviceKey: string, payload: JsonObject = {}): Device | null {
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
      void this.triggerAutomationsForEvent(event).catch((error) => {
        console.error('automation-runner-error', error);
      });
    }
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
      result: { entityId, entityName: entity.name, entityType: entity.type, deviceId: entity.deviceId, command: request.command, params: request.params || {} },
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

  updateIntegration(integrationId: number, name: string, config: JsonObject, secrets: JsonObject, status: IntegrationStatus = 'created'): StoredIntegration | null {
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
    return this.storage.transaction(() => {
      const integration = this.getIntegration(integrationId);
      if (!integration) return false;

      const deviceRows = this.storage.all<{ id: number; inbox_id: number | null }>(
        'SELECT id, inbox_id FROM devices WHERE integration_id = ?',
        [integrationId],
      );

      for (const row of deviceRows) {
        this.deleteDeviceGraph(Number(row.id));
      }

      const linkedInboxIds = Array.from(
        new Set(
          deviceRows
            .map((row) => (typeof row.inbox_id === 'number' ? row.inbox_id : null))
            .filter((inboxId): inboxId is number => inboxId !== null),
        ),
      );
      this.deleteInboxItems(linkedInboxIds);

      this.storage.run('DELETE FROM device_inbox WHERE source_type = ? AND source_id = ?', ['integration', integrationId]);

      return this.storage.run('DELETE FROM integrations WHERE id = ?', [integrationId]).changes > 0;
    });
  }

  publicIntegration(integration: StoredIntegration): Integration {
    const { secrets: _secrets, ...publicValue } = integration;
    return publicValue;
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

  private hasAcceptedOrAddedInboxDevice(device: InboxDevice): boolean {
    if (device.sourceType === 'discovery' || String(device.payload.provider || '') === 'discovery') {
      const identification = nested(device.payload, 'identification') || {};
      const isGenericTuyaDiscovery =
        String(device.payload.manufacturer || '').trim().toLowerCase() === 'tuya' ||
        String(identification.label || '').trim() === 'Dispositivo Tuya local';
      if (isGenericTuyaDiscovery && this.listDevices().some((savedDevice) => savedDevice.provider === 'tuya_cloud')) {
        return true;
      }

      const discoveryMac = String(device.payload.mac || '').toUpperCase();
      const discoveryIp = String(device.payload.ip || '');
      if (discoveryMac || discoveryIp) {
        const savedDevices = this.listDevices();
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

  private deleteInboxItems(inboxIds: number[]): void {
    if (!inboxIds.length) return;
    const placeholders = inboxIds.map(() => '?').join(', ');
    this.storage.run(`DELETE FROM device_inbox WHERE id IN (${placeholders})`, inboxIds);
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

  private fromDeviceEventLogRow(row: JsonObject): DeviceEvent {
    return {
      id: row.id,
      deviceId: row.device_id,
      eventType: row.event_type,
      title: row.title,
      message: row.message,
      level: row.level || 'info',
      payload: this.storage.jsonLoad(row.payload_json, {}),
      createdAt: row.created_at,
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

  private fromSceneRow(row: JsonObject): Scene {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      roomId: row.room_id,
      roomName: row.room_name,
      actions: this.listSceneActions(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private fromAutomationRow(row: JsonObject): Automation {
    const trigger = this.getAutomationTrigger(row.id);
    if (!trigger) throw new Error(`Automacao ${row.id} sem trigger configurado.`);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      enabled: Number(row.enabled) !== 0,
      roomId: row.room_id,
      roomName: row.room_name,
      sceneId: row.scene_id,
      sceneName: row.scene_name,
      trigger,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getAutomationRun(automationRunId: number): AutomationRun | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM automation_runs WHERE id = ?', [automationRunId]);
    return row ? fromAutomationRunRow(row) : null;
  }

  private getSceneRun(sceneRunId: number): SceneRun | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM scene_runs WHERE id = ?', [sceneRunId]);
    return row ? fromSceneRunRow(row) : null;
  }

  private getAutomationTrigger(automationId: number): AutomationTrigger | null {
    const row = this.storage.get<JsonObject>('SELECT * FROM automation_triggers WHERE automation_id = ? LIMIT 1', [automationId]);
    return row ? fromAutomationTriggerRow(row) : null;
  }

  private listSceneActions(sceneId: number): SceneAction[] {
    const rows = this.storage.all<JsonObject>(
      `
      SELECT scene_actions.*, devices.name AS device_name, devices.device_type AS device_type
      FROM scene_actions
      INNER JOIN devices ON devices.id = scene_actions.device_id
      WHERE scene_actions.scene_id = ?
      ORDER BY scene_actions.order_index ASC, scene_actions.id ASC
      `,
      [sceneId],
    );
    return rows.map(fromSceneActionRow);
  }

  private replaceSceneActions(sceneId: number, actions: NormalizedSceneAction[], now: string): void {
    this.storage.run('DELETE FROM scene_actions WHERE scene_id = ?', [sceneId]);
    for (const action of actions) {
      this.storage.run(
        `
        INSERT INTO scene_actions (scene_id, device_id, order_index, command, params_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [sceneId, action.deviceId, action.orderIndex, action.command, this.storage.jsonDump(action.params), now, now],
      );
    }
  }

  private replaceAutomationTrigger(automationId: number, trigger: NormalizedAutomationTrigger, now: string): void {
    this.storage.run('DELETE FROM automation_triggers WHERE automation_id = ?', [automationId]);
    this.storage.run(
      `
      INSERT INTO automation_triggers (automation_id, type, device_id, entity_id, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [automationId, trigger.type, trigger.deviceId, trigger.entityId, this.storage.jsonDump(trigger.config), now, now],
    );
  }

  private async triggerAutomationsForEvent(event: AutomationSourceEvent): Promise<void> {
    if (event.payload.sourceType === 'scene') return;
    if (!['state_changed', 'entity_state_changed'].includes(event.eventType)) return;

    const automations = this.listAutomationsForEvent(event);
    for (const automation of automations) {
      await this.runAutomationFromEvent(automation, event);
    }
  }

  private listAutomationsForEvent(event: AutomationSourceEvent): Automation[] {
    if (event.eventType === 'state_changed') {
      const rows = this.storage.all<JsonObject>(
        `
        SELECT automations.*, rooms.name AS room_name, scenes.name AS scene_name
        FROM automations
        INNER JOIN automation_triggers ON automation_triggers.automation_id = automations.id
        LEFT JOIN rooms ON rooms.id = automations.room_id
        INNER JOIN scenes ON scenes.id = automations.scene_id
        WHERE automations.enabled = 1
          AND automation_triggers.type = 'device_state_changed'
          AND automation_triggers.device_id = ?
        ORDER BY automations.id ASC
        `,
        [event.deviceId],
      );

      return rows.map((row) => this.fromAutomationRow(row));
    }

    const entityId = Number(event.payload.entityId);
    if (!Number.isInteger(entityId) || entityId <= 0) return [];

    const rows = this.storage.all<JsonObject>(
      `
      SELECT automations.*, rooms.name AS room_name, scenes.name AS scene_name
      FROM automations
      INNER JOIN automation_triggers ON automation_triggers.automation_id = automations.id
      LEFT JOIN rooms ON rooms.id = automations.room_id
      INNER JOIN scenes ON scenes.id = automations.scene_id
      WHERE automations.enabled = 1
        AND automation_triggers.type = 'entity_state_changed'
        AND automation_triggers.entity_id = ?
      ORDER BY automations.id ASC
      `,
      [entityId],
    );

    return rows.map((row) => this.fromAutomationRow(row));
  }

  private async runAutomationFromEvent(automation: Automation, event: AutomationSourceEvent): Promise<void> {
    const startedAt = this.storage.utcNow();
    const pendingRun = this.startAutomationRun(automation.id, {
      automationId: automation.id,
      automationName: automation.name,
      sceneId: automation.sceneId,
      sceneName: automation.sceneName,
      triggerType: automation.trigger.type,
      event: automationEventSummary(event),
      startedAt,
      status: 'pending',
    });

    try {
      const sceneRun = await this.runScene(
        automation.sceneId,
        (device, secrets, request) => this.commands.executeDeviceCommand(device, secrets, request),
        { automationId: automation.id, automationName: automation.name },
      );

      const sceneSummary = sceneRun?.summary && isObject(sceneRun.summary) ? sceneRun.summary : {};
      const status: SceneRunStatus = sceneRun?.status || 'error';

      this.completeAutomationRun(pendingRun.id, status, {
        automationId: automation.id,
        automationName: automation.name,
        sceneId: automation.sceneId,
        sceneName: automation.sceneName,
        triggerType: automation.trigger.type,
        event: automationEventSummary(event),
        sceneRunId: sceneRun?.id || null,
        sceneRunStatus: sceneRun?.status || 'error',
        sceneRunSummary: sceneSummary,
        successCount: typeof sceneSummary.successCount === 'number' ? sceneSummary.successCount : 0,
        errorCount: typeof sceneSummary.errorCount === 'number' ? sceneSummary.errorCount : sceneRun ? 0 : 1,
        startedAt,
        finishedAt: this.storage.utcNow(),
        status,
        error: sceneRun ? null : 'Cena da automacao nao encontrada no momento da execucao.',
      });
    } catch (error) {
      this.completeAutomationRun(pendingRun.id, 'error', {
        automationId: automation.id,
        automationName: automation.name,
        sceneId: automation.sceneId,
        sceneName: automation.sceneName,
        triggerType: automation.trigger.type,
        event: automationEventSummary(event),
        sceneRunId: null,
        sceneRunStatus: 'error',
        sceneRunSummary: {},
        successCount: 0,
        errorCount: 1,
        startedAt,
        finishedAt: this.storage.utcNow(),
        status: 'error',
        error: error instanceof Error ? error.message : 'Falha inesperada ao executar automacao.',
      });
    }
  }

  private enrichSceneCommandResult(result: CommandResult, scene: Scene, action: SceneAction, sourceMetadata: JsonObject = {}): CommandResult {
    return {
      ...result,
      result: {
        ...(isObject(result.result) ? result.result : {}),
        scene: {
          sceneId: scene.id,
          sceneName: scene.name,
          actionId: action.id,
          orderIndex: action.orderIndex,
          ...redactSecrets(sourceMetadata),
        },
      },
    };
  }

  private normalizeSceneRoomId(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const roomId = Number(value);
    if (!Number.isInteger(roomId) || roomId <= 0) throw new Error('roomId invalido.');
    if (!this.getRoom(roomId)) throw new Error('Room informado nao existe.');
    return roomId;
  }

  private normalizeAutomationRoomId(value: unknown): number | null {
    return this.normalizeSceneRoomId(value);
  }

  private normalizeAutomationSceneId(value: unknown): number {
    const sceneId = Number(value);
    if (!Number.isInteger(sceneId) || sceneId <= 0) throw new Error('sceneId invalido.');
    if (!this.getScene(sceneId)) throw new Error('Cena informada nao existe.');
    return sceneId;
  }

  private normalizeAutomationEnabled(value: unknown, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;

    throw new Error('enabled invalido.');
  }

  private normalizeAutomationTrigger(value: unknown): NormalizedAutomationTrigger {
    if (!isObject(value)) throw new Error('trigger invalido.');

    const type = String(value.type || '').trim().toLowerCase() as AutomationTriggerType;
    if (!AUTOMATION_ALLOWED_TRIGGER_TYPES.has(type)) {
      throw new Error(`Trigger ${type || '(vazio)'} nao e suportado no MVP.`);
    }

    const config = isObject(value.config) ? value.config : {};

    if (type === 'device_state_changed') {
      const deviceId = Number(value.deviceId);
      if (!Number.isInteger(deviceId) || deviceId <= 0) throw new Error('trigger.deviceId invalido.');
      if (!this.getDevice(deviceId)) throw new Error('Dispositivo informado no trigger nao existe.');

      return {
        type,
        deviceId,
        entityId: null,
        config,
      };
    }

    const entityId = Number(value.entityId);
    if (!Number.isInteger(entityId) || entityId <= 0) throw new Error('trigger.entityId invalido.');
    const entity = this.getEntity(entityId);
    if (!entity) throw new Error('Entidade informada no trigger nao existe.');

    return {
      type,
      deviceId: entity.deviceId,
      entityId,
      config,
    };
  }

  private normalizeSceneActions(value: unknown, options: { requireActions: boolean }): NormalizedSceneAction[] {
    if (!Array.isArray(value)) {
      throw new Error('actions deve ser uma lista.');
    }

    if (options.requireActions && !value.length) {
      throw new Error('A cena precisa de pelo menos uma acao.');
    }

    const normalized = value.map((item, index) => {
      if (!isObject(item)) throw new Error(`Acao ${index + 1} invalida.`);

      const deviceId = Number(item.deviceId);
      if (!Number.isInteger(deviceId) || deviceId <= 0) {
        throw new Error(`Acao ${index + 1} com deviceId invalido.`);
      }

      if (!this.getDevice(deviceId)) {
        throw new Error(`Dispositivo ${deviceId} nao encontrado para a acao ${index + 1}.`);
      }

      const command = String(item.command || '').trim().toLowerCase();
      if (!SCENE_ALLOWED_COMMANDS.has(command)) {
        throw new Error(`Comando ${command || '(vazio)'} nao e suportado em scenes no MVP.`);
      }

      const params = isObject(item.params) ? item.params : {};
      if (command === 'set_position') {
        const position = Number(params.position);
        if (!Number.isFinite(position)) {
          throw new Error(`Acao ${index + 1} precisa de params.position para set_position.`);
        }
      }
      if (command === 'arm_partition' || command === 'disarm_partition') {
        const partition = Number(params.partition);
        if (!Number.isInteger(partition) || partition < 1 || partition > 15) {
          throw new Error(`Acao ${index + 1} precisa de params.partition entre 1 e 15.`);
        }
      }

      const rawOrderIndex = has(item, 'orderIndex') ? Number(item.orderIndex) : index + 1;
      if (!Number.isInteger(rawOrderIndex) || rawOrderIndex <= 0) {
        throw new Error(`Acao ${index + 1} com orderIndex invalido.`);
      }

      return {
        deviceId,
        orderIndex: rawOrderIndex,
        command,
        params,
      };
    });

    const uniqueOrderIndexes = new Set(normalized.map((item) => item.orderIndex));
    if (uniqueOrderIndexes.size !== normalized.length) {
      throw new Error('Cada acao precisa ter um orderIndex unico.');
    }

    return normalized
      .sort((left, right) => left.orderIndex - right.orderIndex)
      .map((item, index) => ({ ...item, orderIndex: index + 1 }));
  }
}

type NormalizedSceneAction = {
  deviceId: number;
  orderIndex: number;
  command: string;
  params: JsonObject;
};

type NormalizedAutomationTrigger = {
  type: AutomationTriggerType;
  deviceId?: number | null;
  entityId?: number | null;
  config: JsonObject;
};

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

function fromRoomRow(row: JsonObject): Room {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    floorId: row.floor_id,
    floorName: row.floor_name,
    devicesCount: row.devices_count,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromSceneActionRow(row: JsonObject): SceneAction {
  return {
    id: row.id,
    sceneId: row.scene_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceType: row.device_type,
    orderIndex: row.order_index,
    command: row.command,
    params: safeJsonObject(row.params_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromAutomationTriggerRow(row: JsonObject): AutomationTrigger {
  return {
    id: row.id,
    automationId: row.automation_id,
    type: row.type,
    deviceId: row.device_id,
    entityId: row.entity_id,
    config: safeJsonObject(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromAutomationRunRow(row: JsonObject): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status,
    summary: safeJsonObject(row.summary_json),
    createdAt: row.created_at,
  };
}

function fromSceneRunRow(row: JsonObject): SceneRun {
  return {
    id: row.id,
    sceneId: row.scene_id,
    status: row.status,
    summary: safeJsonObject(row.summary_json),
    createdAt: row.created_at,
  };
}

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

function automationEventSummary(event: AutomationSourceEvent): JsonObject {
  return {
    id: event.id,
    deviceId: event.deviceId,
    eventType: event.eventType,
    title: event.title,
    message: event.message,
    level: event.level,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

function has(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function safeJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
