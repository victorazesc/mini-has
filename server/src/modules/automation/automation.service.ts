import { Injectable } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { Automation, AutomationRun, AutomationTrigger, AutomationTriggerType, DeviceEventLevel, JsonObject, SceneRunStatus } from '../../types';
import { DeviceService } from '../device/device.service';
import { EntityService } from '../entity/entity.service';
import { RoomService } from '../room/room.service';
import { SceneService } from '../scene/scene.service';

const AUTOMATION_ALLOWED_TRIGGER_TYPES = new Set<AutomationTriggerType>(['device_state_changed', 'entity_state_changed']);

@Injectable()
export class AutomationService {
    constructor(
        private readonly storage: StorageService,
        private readonly rooms: RoomService,
        private readonly scenes: SceneService,
        private readonly devices: DeviceService,
        private readonly entities: EntityService,
    ) { }

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

    listAutomationRuns(automationId: number, limit = 10): AutomationRun[] {
        const safeLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
        const rows = this.storage.all<JsonObject>(
            'SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
            [automationId, safeLimit],
        );
        return rows.map((row) => fromAutomationRunRow(row));
    }

    createAutomation(body: JsonObject): Automation {
        const name = String(body.name || '').trim();
        if (!name) throw new Error('Nome da automacao e obrigatorio.');

        const roomId = this.normalizeAutomationRoomId(body.roomId);
        const sceneId = this.normalizeAutomationSceneId(body.sceneId);
        const enabled = this.normalizeAutomationEnabled(body.enabled, true);
        const trigger = this.normalizeAutomationTrigger(body.trigger);
        const now = this.storage.utcNow();

        const automationId = this.storage.transaction(() => {
            const result = this.storage.run(
                'INSERT INTO automations (name, description, enabled, room_id, scene_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, nullableText(body.description), enabled ? 1 : 0, roomId, sceneId, now, now],
            );
            this.replaceAutomationTrigger(Number(result.lastInsertRowid), trigger, now);
            return Number(result.lastInsertRowid);
        });

        return this.getAutomation(automationId) as Automation;
    }

    updateAutomation(automationId: number, body: JsonObject): Automation | null {
        const current = this.getAutomation(automationId);
        if (!current) return null;

        const assignments: string[] = [];
        const values: unknown[] = [];

        if (has(body, 'name')) {
            const name = String(body.name || '').trim();
            if (!name) throw new Error('Nome da automacao e obrigatorio.');
            assignments.push('name = ?');
            values.push(name);
        }

        if (has(body, 'description')) {
            assignments.push('description = ?');
            values.push(nullableText(body.description));
        }

        if (has(body, 'enabled')) {
            assignments.push('enabled = ?');
            values.push(this.normalizeAutomationEnabled(body.enabled, current.enabled) ? 1 : 0);
        }

        if (has(body, 'roomId')) {
            assignments.push('room_id = ?');
            values.push(this.normalizeAutomationRoomId(body.roomId));
        }

        if (has(body, 'sceneId')) {
            assignments.push('scene_id = ?');
            values.push(this.normalizeAutomationSceneId(body.sceneId));
        }

        const shouldReplaceTrigger = has(body, 'trigger');
        const trigger = shouldReplaceTrigger ? this.normalizeAutomationTrigger(body.trigger) : null;

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

    async triggerAutomationsForEvent(event: AutomationSourceEvent): Promise<void> {
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
            const sceneRun = await this.scenes.runScene(automation.sceneId, { automationId: automation.id, automationName: automation.name });
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

    private startAutomationRun(automationId: number, summary: JsonObject = {}): AutomationRun {
        const now = this.storage.utcNow();
        const result = this.storage.run(
            'INSERT INTO automation_runs (automation_id, status, summary_json, created_at) VALUES (?, ?, ?, ?)',
            [automationId, 'pending', this.storage.jsonDump(summary), now],
        );
        return this.getAutomationRun(Number(result.lastInsertRowid)) as AutomationRun;
    }

    private completeAutomationRun(automationRunId: number, status: SceneRunStatus, summary: JsonObject): AutomationRun | null {
        this.storage.run('UPDATE automation_runs SET status = ?, summary_json = ? WHERE id = ?', [status, this.storage.jsonDump(summary), automationRunId]);
        return this.getAutomationRun(automationRunId);
    }

    private fromAutomationRow(row: JsonObject): Automation {
        const trigger = this.getAutomationTrigger(Number(row.id));
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

    private getAutomationTrigger(automationId: number): AutomationTrigger | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM automation_triggers WHERE automation_id = ? LIMIT 1', [automationId]);
        return row ? fromAutomationTriggerRow(row) : null;
    }

    private getAutomationRun(automationRunId: number): AutomationRun | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM automation_runs WHERE id = ?', [automationRunId]);
        return row ? fromAutomationRunRow(row) : null;
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

    private normalizeAutomationRoomId(value: unknown): number | null {
        if (value === undefined || value === null || value === '') return null;
        const roomId = Number(value);
        if (!Number.isInteger(roomId) || roomId <= 0) throw new Error('roomId invalido.');
        if (!this.rooms.getRoom(roomId)) throw new Error('Room informado nao existe.');
        return roomId;
    }

    private normalizeAutomationSceneId(value: unknown): number {
        const sceneId = Number(value);
        if (!Number.isInteger(sceneId) || sceneId <= 0) throw new Error('sceneId invalido.');
        if (!this.scenes.getScene(sceneId)) throw new Error('Cena informada nao existe.');
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
            if (!this.devices.getDevice(deviceId)) throw new Error('Dispositivo informado no trigger nao existe.');

            return {
                type,
                deviceId,
                entityId: null,
                config,
            };
        }

        const entityId = Number(value.entityId);
        if (!Number.isInteger(entityId) || entityId <= 0) throw new Error('trigger.entityId invalido.');
        const entity = this.entities.getEntity(entityId);
        if (!entity) throw new Error('Entidade informada no trigger nao existe.');

        return {
            type,
            deviceId: entity.deviceId,
            entityId,
            config,
        };
    }
}

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