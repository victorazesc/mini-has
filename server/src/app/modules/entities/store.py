from __future__ import annotations

from typing import Any

from src.app.core.storage import connect, json_dumps, json_loads, utc_now
from src.app.modules.entities.schemas import CommandRequest, CommandResult, Entity
from src.app.modules.integrations.store import ensure_home_schema


def list_entities() -> list[Entity]:
    ensure_home_schema()
    with connect() as connection:
        rows = connection.execute("SELECT * FROM entities ORDER BY id").fetchall()
    return [_from_row(row) for row in rows]


def get_entity(entity_id: int) -> Entity | None:
    ensure_home_schema()
    with connect() as connection:
        row = connection.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
    return _from_row(row) if row else None


def create_entities_for_device(device_id: int, provider: str, external_id: str, entities: list[dict[str, Any]]) -> list[Entity]:
    ensure_home_schema()
    now = utc_now()
    created: list[Entity] = []
    with connect() as connection:
        for entity in entities:
            key = str(entity.get("key") or entity.get("type") or "main")
            unique_key = f"{provider}:{external_id}:{key}"
            connection.execute(
                """
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
                """,
                (
                    device_id,
                    unique_key,
                    entity.get("type") or "unknown",
                    entity.get("name") or "Entidade",
                    json_dumps(entity.get("commandSchema") or entity.get("command_schema") or {}),
                    json_dumps(entity.get("state") or {}),
                    json_dumps(entity.get("capabilities") or {}),
                    now,
                    now,
                ),
            )
        rows = connection.execute("SELECT * FROM entities WHERE device_id = ? ORDER BY id", (device_id,)).fetchall()
        created = [_from_row(row) for row in rows]
    return created


def log_command(entity_id: int, request: CommandRequest) -> CommandResult | None:
    entity = get_entity(entity_id)
    if not entity:
        return None
    result = CommandResult(
        ok=True,
        status="accepted",
        message="Comando registrado. Runtime especifico do provider sera plugado na proxima etapa.",
        result={"entityId": entity_id, "command": request.command, "params": request.params},
    )
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO command_logs (entity_id, command_json, result_json, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (entity_id, json_dumps(request.model_dump()), json_dumps(result.model_dump()), result.status, utc_now()),
        )
    return result


def _from_row(row) -> Entity:
    return Entity(
        id=row["id"],
        deviceId=row["device_id"],
        uniqueKey=row["unique_key"],
        type=row["type"],
        name=row["name"],
        commandSchema=json_loads(row["command_schema_json"], {}),
        state=json_loads(row["state_json"], {}),
        capabilities=json_loads(row["capabilities_json"], {}),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )
