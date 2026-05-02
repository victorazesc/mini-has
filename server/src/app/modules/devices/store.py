from __future__ import annotations

from typing import Any

from src.app.core.storage import connect, json_dumps, json_loads, utc_now
from src.app.modules.devices.schema import Device, DeviceCreateRequest, DeviceUpdateRequest
from src.app.modules.inbox.schemas import InboxDevice
from src.app.modules.integrations.store import ensure_home_schema


def list_devices() -> list[Device]:
    ensure_home_schema()
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT devices.*, rooms.name AS room_name
            FROM devices
            LEFT JOIN rooms ON rooms.id = devices.room_id
            ORDER BY devices.id
            """
        ).fetchall()
    return [_from_row(row) for row in rows]


def get_device(device_id: int) -> Device | None:
    ensure_home_schema()
    with connect() as connection:
        row = connection.execute(
            """
            SELECT devices.*, rooms.name AS room_name
            FROM devices
            LEFT JOIN rooms ON rooms.id = devices.room_id
            WHERE devices.id = ?
            """,
            (device_id,),
        ).fetchone()
    return _from_row(row) if row else None


def create_device(request: DeviceCreateRequest) -> Device:
    ensure_home_schema()
    now = utc_now()
    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO devices
                (integration_id, inbox_id, external_id, local_device_key, name, device_type, provider, room_id,
                 payload_json, secrets_json, capabilities_json, status_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                None,
                None,
                request.external_id,
                request.local_device_key,
                request.name,
                request.device_type,
                request.provider,
                request.room_id,
                json_dumps(request.payload),
                "{}",
                json_dumps(request.capabilities),
                json_dumps(request.status),
                now,
                now,
            ),
        )
        device_id = int(cursor.lastrowid)
    return get_device(device_id)  # type: ignore[return-value]


def update_device(device_id: int, request: DeviceUpdateRequest) -> Device | None:
    current = get_device(device_id)
    if not current:
        return None
    updates = request.model_dump(exclude_unset=True)
    field_map = {
        "name": "name",
        "device_type": "device_type",
        "room_id": "room_id",
        "local_device_key": "local_device_key",
    }
    assignments = []
    values: list[Any] = []
    for source, target in field_map.items():
        if source in updates:
            assignments.append(f"{target} = ?")
            values.append(updates[source])
    if "payload" in updates:
        assignments.append("payload_json = ?")
        values.append(json_dumps(updates["payload"]))
    if "capabilities" in updates:
        assignments.append("capabilities_json = ?")
        values.append(json_dumps(updates["capabilities"]))
    if "status" in updates:
        assignments.append("status_json = ?")
        values.append(json_dumps(updates["status"]))
    if not assignments:
        return current

    assignments.append("updated_at = ?")
    values.extend([utc_now(), device_id])
    with connect() as connection:
        connection.execute(f"UPDATE devices SET {', '.join(assignments)} WHERE id = ?", values)
    return get_device(device_id)


def delete_device(device_id: int) -> bool:
    ensure_home_schema()
    with connect() as connection:
        connection.execute("DELETE FROM entities WHERE device_id = ?", (device_id,))
        cursor = connection.execute("DELETE FROM devices WHERE id = ?", (device_id,))
    return cursor.rowcount > 0


def link_local_device(device_id: int, local_device_key: str, payload: dict[str, Any] | None = None) -> Device | None:
    device = get_device(device_id)
    if not device:
        return None
    next_payload = {**device.payload, "local": payload or {}, "localDeviceKey": local_device_key}
    with connect() as connection:
        connection.execute(
            "UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?",
            (local_device_key, json_dumps(next_payload), utc_now(), device_id),
        )
    return get_device(device_id)


def accept_inbox_device(inbox: InboxDevice, secrets: dict[str, Any], name: str | None, room_id: int | None) -> Device:
    payload = inbox.payload
    now = utc_now()
    provider = str(payload.get("provider") or inbox.source_type)
    external_id = str(payload.get("externalId") or inbox.external_id)
    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM devices WHERE provider = ? AND external_id = ?",
            (provider, external_id),
        ).fetchone()
        values = (
            inbox.source_id if inbox.source_type == "integration" else None,
            inbox.id,
            external_id,
            payload.get("localDeviceKey"),
            name or payload.get("name") or "Dispositivo",
            payload.get("deviceType") or "unknown",
            provider,
            room_id,
            json_dumps(payload),
            json_dumps(secrets),
            json_dumps(payload.get("capabilities") or {}),
            json_dumps(payload.get("status") or {}),
            now,
        )
        if existing:
            connection.execute(
                """
                UPDATE devices
                SET integration_id = ?, inbox_id = ?, external_id = ?, local_device_key = ?, name = ?,
                    device_type = ?, provider = ?, room_id = COALESCE(?, room_id), payload_json = ?,
                    secrets_json = ?, capabilities_json = ?, status_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (*values, existing["id"]),
            )
            device_id = int(existing["id"])
        else:
            cursor = connection.execute(
                """
                INSERT INTO devices
                    (integration_id, inbox_id, external_id, local_device_key, name, device_type, provider, room_id,
                     payload_json, secrets_json, capabilities_json, status_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (*values, now),
            )
            device_id = int(cursor.lastrowid)
    return get_device(device_id)  # type: ignore[return-value]


def _from_row(row) -> Device:
    return Device(
        id=row["id"],
        integrationId=row["integration_id"],
        inboxId=row["inbox_id"],
        externalId=row["external_id"],
        localDeviceKey=row["local_device_key"],
        name=row["name"],
        deviceType=row["device_type"],
        provider=row["provider"],
        roomId=row["room_id"],
        roomName=row["room_name"],
        payload=json_loads(row["payload_json"], {}),
        capabilities=json_loads(row["capabilities_json"], {}),
        status=json_loads(row["status_json"], {}),
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )
