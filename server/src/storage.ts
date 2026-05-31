import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database, { RunResult } from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly db: Database.Database;

  constructor() {
    const dbPath = resolve(process.cwd(), process.env.MINI_HAS_DB || 'data/mini-has.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.ensureSchema();
  }

  onModuleDestroy() {
    this.db.close();
  }

  all<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...this.bind(params)) as T[];
  }

  get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...this.bind(params)) as T | undefined;
  }

  run(sql: string, params: unknown[] = []): RunResult {
    return this.db.prepare(sql).run(...this.bind(params));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  utcNow(): string {
    return new Date().toISOString();
  }

  jsonDump(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  jsonLoad<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        secrets_json TEXT NOT NULL,
        error TEXT,
        last_sync_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        icon TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id INTEGER NOT NULL DEFAULT 0,
        external_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        secrets_json TEXT NOT NULL,
        match_score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_type, source_id, external_id)
      );
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id INTEGER,
        inbox_id INTEGER,
        external_id TEXT NOT NULL,
        local_device_key TEXT,
        name TEXT NOT NULL,
        device_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        room_id INTEGER,
        payload_json TEXT NOT NULL,
        secrets_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        status_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider, external_id)
      );
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        unique_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        command_schema_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(device_id) REFERENCES devices(id)
      );
      CREATE TABLE IF NOT EXISTS command_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL,
        command_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(entity_id) REFERENCES entities(id)
      );
      CREATE TABLE IF NOT EXISTS device_command_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        command_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(device_id) REFERENCES devices(id)
      );
      CREATE TABLE IF NOT EXISTS discovery_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS discovery_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_scan_id INTEGER,
        FOREIGN KEY(last_scan_id) REFERENCES discovery_scans(id)
      );
      CREATE INDEX IF NOT EXISTS idx_device_inbox_status ON device_inbox(status);
      CREATE INDEX IF NOT EXISTS idx_devices_room_id ON devices(room_id);
      CREATE INDEX IF NOT EXISTS idx_entities_device_id ON entities(device_id);
      CREATE INDEX IF NOT EXISTS idx_discovery_scans_created_at ON discovery_scans(created_at);
      CREATE INDEX IF NOT EXISTS idx_discovery_devices_last_seen_at ON discovery_devices(last_seen_at);
    `);
    this.ensureColumn('rooms', 'icon', 'TEXT');
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private bind(params: unknown[]): unknown[] {
    return params.map((value) => (value === undefined ? null : value));
  }
}
