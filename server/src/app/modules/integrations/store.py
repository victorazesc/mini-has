from __future__ import annotations

from typing import Any

from src.app.core.storage import connect, json_dumps, json_loads, utc_now
from src.app.modules.integrations.schemas import (
    CreateIntegrationRequest,
    IntegrationStatus,
    IntegrationType,
    StoredIntegration,
)

_initialized = False


def ensure_home_schema() -> None:
    global _initialized
    if _initialized:
        return

    with connect() as connection:
        connection.execute(
            """
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
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
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
            )
            """
        )
        connection.execute(
            """
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
            )
            """
        )
        connection.execute(
            """
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
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS command_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id INTEGER NOT NULL,
                command_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(entity_id) REFERENCES entities(id)
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_device_inbox_status ON device_inbox(status)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_devices_room_id ON devices(room_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_entities_device_id ON entities(device_id)")

    _initialized = True


def create_integration(
    request: CreateIntegrationRequest,
    config: dict[str, Any],
    secrets: dict[str, Any],
    status: IntegrationStatus = IntegrationStatus.created,
) -> StoredIntegration:
    ensure_home_schema()
    now = utc_now()
    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO integrations (type, name, status, config_json, secrets_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request.type.value,
                request.name,
                status.value,
                json_dumps(config),
                json_dumps(secrets),
                now,
                now,
            ),
        )
        integration_id = int(cursor.lastrowid)
    return get_integration(integration_id)  # type: ignore[return-value]


def find_integration_by_config_value(provider_type: IntegrationType, key: str, value: str) -> StoredIntegration | None:
    ensure_home_schema()
    normalized = value.strip()
    if not normalized:
        return None
    with connect() as connection:
        rows = connection.execute("SELECT * FROM integrations WHERE type = ?", (provider_type.value,)).fetchall()
    for row in rows:
        config = json_loads(row["config_json"], {})
        if str(config.get(key) or "").strip() == normalized:
            return _from_row(row)
    return None


def list_integrations() -> list[StoredIntegration]:
    ensure_home_schema()
    with connect() as connection:
        rows = connection.execute("SELECT * FROM integrations ORDER BY id").fetchall()
    return [_from_row(row) for row in rows]


def get_integration(integration_id: int) -> StoredIntegration | None:
    ensure_home_schema()
    with connect() as connection:
        row = connection.execute("SELECT * FROM integrations WHERE id = ?", (integration_id,)).fetchone()
    return _from_row(row) if row else None


def update_integration_status(
    integration_id: int,
    status: IntegrationStatus,
    error: str | None = None,
    last_sync_at: str | None = None,
) -> StoredIntegration | None:
    ensure_home_schema()
    now = utc_now()
    with connect() as connection:
        connection.execute(
            """
            UPDATE integrations
            SET status = ?, error = ?, last_sync_at = COALESCE(?, last_sync_at), updated_at = ?
            WHERE id = ?
            """,
            (status.value, error, last_sync_at, now, integration_id),
        )
    return get_integration(integration_id)


def delete_integration(integration_id: int) -> bool:
    ensure_home_schema()
    with connect() as connection:
        cursor = connection.execute("DELETE FROM integrations WHERE id = ?", (integration_id,))
    return cursor.rowcount > 0


def _from_row(row) -> StoredIntegration:
    return StoredIntegration(
        id=row["id"],
        type=row["type"],
        name=row["name"],
        status=row["status"],
        config=json_loads(row["config_json"], {}),
        secrets=json_loads(row["secrets_json"], {}),
        error=row["error"],
        lastSyncAt=row["last_sync_at"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )
