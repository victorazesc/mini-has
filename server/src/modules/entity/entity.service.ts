import { Injectable } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { CommandRequest, CommandResult, Entity, JsonObject, ProviderEntity } from '../../types';

@Injectable()
export class EntityService {
    constructor(private readonly storage: StorageService) { }

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

    updateEntity(entityId: number, body: JsonObject): Entity | null {
        const current = this.getEntity(entityId);
        if (!current) return null;

        if (Object.prototype.hasOwnProperty.call(body, 'name')) {
            const name = String(body.name || '').trim();
            if (!name) throw new Error('Nome da entidade e obrigatorio.');
            this.storage.run('UPDATE entities SET name = ?, updated_at = ? WHERE id = ?', [name, this.storage.utcNow(), entityId]);
        }

        return this.getEntity(entityId);
    }

    commandEntity(entityId: number, body: CommandRequest): CommandResult | null {
        const request = { command: body.command, params: body.params || {} };
        const entity = this.getEntity(entityId);
        if (!entity) return null;
        const result: CommandResult = {
            ok: true,
            status: 'accepted',
            message: 'Comando registrado. Runtime especifico do provider sera plugado na proxima etapa.',
            result: { entityId, entityName: entity.name, entityType: entity.type, deviceId: entity.deviceId, command: request.command, params: request.params },
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
}
