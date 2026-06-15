import { Injectable } from '@nestjs/common';
import { JsonObject } from '../../types';
import { StorageService } from '../../infrastructure/storage/storage.service';

const BACKUP_VERSION = 1;

const BACKUP_TABLES = [
    'integrations',
    'floors',
    'rooms',
    'device_inbox',
    'discovery_scans',
    'discovery_devices',
    'devices',
    'entities',
    'floor_device_positions',
    'floor_entity_positions',
    'scenes',
    'scene_actions',
    'scene_runs',
    'automations',
    'automation_triggers',
    'automation_runs',
    'command_logs',
    'device_command_logs',
    'device_events',
    'solar_readings',
    'camera_recordings',
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

type BackupFile = {
    app: 'mini-has';
    version: number;
    exportedAt: string;
    tables: Record<string, JsonObject[]>;
};

type ForeignKeyViolation = {
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
};

@Injectable()
export class BackupService {
    constructor(private readonly storage: StorageService) { }

    exportBackup(): BackupFile {
        const tables = BACKUP_TABLES.reduce<Record<string, JsonObject[]>>((result, table) => {
            result[table] = this.storage.all<JsonObject>(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid ASC`);
            return result;
        }, {});

        return {
            app: 'mini-has',
            version: BACKUP_VERSION,
            exportedAt: this.storage.utcNow(),
            tables,
        };
    }

    restoreBackup(input: unknown) {
        const backup = parseBackup(input);
        const sanitized = sanitizeBackupTables(backup.tables);
        const restored = this.storage.transaction(() => {
            this.storage.run('PRAGMA defer_foreign_keys = ON');

            for (const table of [...BACKUP_TABLES].reverse()) {
                this.storage.run(`DELETE FROM ${quoteIdentifier(table)}`);
            }

            const counts: Record<string, number> = {};
            for (const table of BACKUP_TABLES) {
                const rows = sanitized.tables[table] || [];
                const columns = this.columnsFor(table);
                for (const row of rows) this.insertRow(table, row, columns);
                counts[table] = rows.length;
                this.refreshSequence(table, rows);
            }

            const violations = this.storage.all<ForeignKeyViolation>('PRAGMA foreign_key_check');
            if (violations.length) throw new Error(foreignKeyMessage(violations));

            return counts;
        });

        return {
            ok: true,
            message: 'Backup restaurado com sucesso.',
            restoredAt: this.storage.utcNow(),
            sourceExportedAt: backup.exportedAt,
            tables: restored,
            skipped: sanitized.skipped,
        };
    }

    private columnsFor(table: BackupTable): string[] {
        return this.storage
            .all<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`)
            .map((column) => column.name);
    }

    private insertRow(table: BackupTable, row: JsonObject, columns: string[]) {
        const rowColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
        if (!rowColumns.length) return;

        const columnSql = rowColumns.map(quoteIdentifier).join(', ');
        const placeholders = rowColumns.map(() => '?').join(', ');
        const values = rowColumns.map((column) => row[column]);

        this.storage.run(
            `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`,
            values,
        );
    }

    private refreshSequence(table: BackupTable, rows: JsonObject[]) {
        const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
        this.storage.run('DELETE FROM sqlite_sequence WHERE name = ?', [table]);
        if (maxId > 0) {
            this.storage.run('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [table, maxId]);
        }
    }
}

function parseBackup(input: unknown): BackupFile {
    if (!isObject(input)) throw new Error('Arquivo de backup invalido.');
    if (input.app !== 'mini-has') throw new Error('Este arquivo nao parece ser um backup do Mini HAS.');
    if (Number(input.version) !== BACKUP_VERSION) throw new Error(`Versao de backup nao suportada: ${String(input.version)}.`);
    if (!isObject(input.tables)) throw new Error('Backup sem tabelas validas.');

    const tables: Record<string, JsonObject[]> = {};
    for (const table of BACKUP_TABLES) {
        const value = input.tables[table];
        if (value === undefined) {
            tables[table] = [];
            continue;
        }
        if (!Array.isArray(value) || !value.every(isObject)) {
            throw new Error(`Tabela ${table} invalida no backup.`);
        }
        tables[table] = value;
    }

    return {
        app: 'mini-has',
        version: BACKUP_VERSION,
        exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : '',
        tables,
    };
}

function sanitizeBackupTables(source: Record<string, JsonObject[]>) {
    const tables = BACKUP_TABLES.reduce<Record<string, JsonObject[]>>((result, table) => {
        result[table] = (source[table] || []).map((row) => ({ ...row }));
        return result;
    }, {});
    const skipped: Record<string, number> = {};

    const rememberSkipped = (table: BackupTable, before: number) => {
        const count = before - tables[table].length;
        if (count > 0) skipped[table] = (skipped[table] || 0) + count;
    };
    const keepRows = (table: BackupTable, predicate: (row: JsonObject) => boolean) => {
        const before = tables[table].length;
        tables[table] = tables[table].filter(predicate);
        rememberSkipped(table, before);
    };
    const ids = (table: BackupTable) => new Set(tables[table].map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0));
    const hasId = (availableIds: Set<number>, value: unknown) => availableIds.has(Number(value));
    const nullMissingReference = (rows: JsonObject[], key: string, availableIds: Set<number>) => {
        for (const row of rows) {
            if (row[key] !== null && row[key] !== undefined && !hasId(availableIds, row[key])) row[key] = null;
        }
    };

    const floorIds = ids('floors');
    nullMissingReference(tables.rooms, 'floor_id', floorIds);

    const roomIds = ids('rooms');
    nullMissingReference(tables.devices, 'room_id', roomIds);
    nullMissingReference(tables.scenes, 'room_id', roomIds);

    const scanIds = ids('discovery_scans');
    nullMissingReference(tables.discovery_devices, 'last_scan_id', scanIds);

    const deviceIds = ids('devices');
    keepRows('entities', (row) => hasId(deviceIds, row.device_id));

    const entityIds = ids('entities');
    keepRows('floor_device_positions', (row) => hasId(floorIds, row.floor_id) && hasId(deviceIds, row.device_id));
    keepRows('floor_entity_positions', (row) => hasId(floorIds, row.floor_id) && hasId(entityIds, row.entity_id));

    const sceneIds = ids('scenes');
    keepRows('scene_actions', (row) => hasId(sceneIds, row.scene_id) && hasId(deviceIds, row.device_id));
    keepRows('scene_runs', (row) => hasId(sceneIds, row.scene_id));

    keepRows('automations', (row) => hasId(sceneIds, row.scene_id));
    nullMissingReference(tables.automations, 'room_id', roomIds);

    const automationIds = ids('automations');
    keepRows('automation_triggers', (row) => hasId(automationIds, row.automation_id));
    nullMissingReference(tables.automation_triggers, 'device_id', deviceIds);
    nullMissingReference(tables.automation_triggers, 'entity_id', entityIds);
    keepRows('automation_runs', (row) => hasId(automationIds, row.automation_id));

    keepRows('command_logs', (row) => hasId(entityIds, row.entity_id));
    keepRows('device_command_logs', (row) => hasId(deviceIds, row.device_id));
    keepRows('device_events', (row) => hasId(deviceIds, row.device_id));
    keepRows('camera_recordings', (row) => hasId(deviceIds, row.device_id));

    return { tables, skipped };
}

function isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function foreignKeyMessage(violations: ForeignKeyViolation[]): string {
    const first = violations[0];
    return `Backup inconsistente: ${violations.length} relacao(oes) invalida(s). Primeira falha em ${first.table} rowid ${first.rowid}, referencia ${first.parent}.`;
}

function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}
