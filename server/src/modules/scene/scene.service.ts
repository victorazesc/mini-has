import { Injectable } from '@nestjs/common';
import { CommandsService } from '../../infrastructure/commands/commands.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { CommandRequest, CommandResult, JsonObject, Scene, SceneAction, SceneRun, SceneRunStatus } from '../../types';
import { DeviceService } from '../device/device.service';
import { dpsIdFromCode } from '../device/device.utils';
import { EntityService } from '../entity/entity.service';
import { RoomService } from '../room/room.service';

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

@Injectable()
export class SceneService {
    constructor(
        private readonly storage: StorageService,
        private readonly rooms: RoomService,
        private readonly devices: DeviceService,
        private readonly entities: EntityService,
        private readonly commands: CommandsService,
    ) { }

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

    listSceneRuns(sceneId: number, limit = 10): SceneRun[] {
        const safeLimit = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
        const rows = this.storage.all<JsonObject>(
            'SELECT * FROM scene_runs WHERE scene_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
            [sceneId, safeLimit],
        );
        return rows.map((row) => fromSceneRunRow(row));
    }

    createScene(body: JsonObject): Scene {
        const name = String(body.name || '').trim();
        if (!name) throw new Error('Nome da cena e obrigatorio.');

        const roomId = this.normalizeSceneRoomId(body.roomId);
        const actions = this.normalizeSceneActions(body.actions, { requireActions: true });
        const now = this.storage.utcNow();

        const sceneId = this.storage.transaction(() => {
            const result = this.storage.run(
                'INSERT INTO scenes (name, description, room_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                [name, nullableText(body.description), roomId, now, now],
            );
            this.replaceSceneActions(Number(result.lastInsertRowid), actions, now);
            return Number(result.lastInsertRowid);
        });

        return this.getScene(sceneId) as Scene;
    }

    updateScene(sceneId: number, body: JsonObject): Scene | null {
        const current = this.getScene(sceneId);
        if (!current) return null;

        const assignments: string[] = [];
        const values: unknown[] = [];

        if (has(body, 'name')) {
            const name = String(body.name || '').trim();
            if (!name) throw new Error('Nome da cena e obrigatorio.');
            assignments.push('name = ?');
            values.push(name);
        }

        if (has(body, 'description')) {
            assignments.push('description = ?');
            values.push(nullableText(body.description));
        }

        if (has(body, 'roomId')) {
            assignments.push('room_id = ?');
            values.push(this.normalizeSceneRoomId(body.roomId));
        }

        const shouldReplaceActions = has(body, 'actions');
        const actions = shouldReplaceActions ? this.normalizeSceneActions(body.actions, { requireActions: true }) : [];

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

    async runScene(sceneId: number, sourceMetadata: JsonObject = {}): Promise<SceneRun | null> {
        const scene = this.getScene(sceneId);
        if (!scene) return null;

        const startedAt = this.storage.utcNow();
        const steps: JsonObject[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (const action of scene.actions) {
            const request: CommandRequest = { command: action.command, params: action.params || {} };
            const deviceItem = this.devices.getDeviceWithSecrets(action.deviceId);

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

            const result = await this.commands.executeDeviceCommand(deviceItem.device, deviceItem.secrets, request);
            const enrichedResult = this.enrichSceneCommandResult(result, scene, action, sourceMetadata);
            this.devices.updateDeviceRuntimeState(action.deviceId, enrichedResult);
            this.devices.logDeviceCommand(action.deviceId, request, enrichedResult, {
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

    private fromSceneRow(row: JsonObject): Scene {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            roomId: row.room_id,
            roomName: row.room_name,
            actions: this.listSceneActions(Number(row.id)),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private getSceneRun(sceneRunId: number): SceneRun | null {
        const row = this.storage.get<JsonObject>('SELECT * FROM scene_runs WHERE id = ?', [sceneRunId]);
        return row ? fromSceneRunRow(row) : null;
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
        if (!this.rooms.getRoom(roomId)) throw new Error('Room informado nao existe.');
        return roomId;
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

            if (!this.devices.getDevice(deviceId)) {
                throw new Error(`Dispositivo ${deviceId} nao encontrado para a acao ${index + 1}.`);
            }

            const command = String(item.command || '').trim().toLowerCase();
            if (!SCENE_ALLOWED_COMMANDS.has(command)) {
                throw new Error(`Comando ${command || '(vazio)'} nao e suportado em scenes no MVP.`);
            }

            const params = isObject(item.params) ? { ...item.params } : {};
            if (has(params, 'entityId')) {
                const entityId = Number(params.entityId);
                const entity = Number.isInteger(entityId) && entityId > 0 ? this.entities.getEntity(entityId) : null;
                if (!entity || entity.deviceId !== deviceId) {
                    throw new Error(`Entidade da acao ${index + 1} nao pertence ao dispositivo ${deviceId}.`);
                }
                const switchCode = String(entity.commandSchema.switchCode || '');
                if (!switchCode) throw new Error(`Entidade da acao ${index + 1} nao possui canal configurado.`);
                params.entityId = entity.id;
                params.dpsId = dpsIdFromCode(switchCode);
            }
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

function fromSceneRunRow(row: JsonObject): SceneRun {
    return {
        id: row.id,
        sceneId: row.scene_id,
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
