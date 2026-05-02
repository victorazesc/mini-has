from __future__ import annotations

from typing import Any

from src.app.core.storage import connect, json_dumps, json_loads, utc_now
from src.app.modules.devices.schema import Device, DeviceCreateRequest, DeviceUpdateRequest
from src.app.modules.entities.schemas import CommandRequest, CommandResult
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


def get_device_with_secrets(device_id: int) -> tuple[Device, dict[str, Any]] | None:
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
    if not row:
        return None
    return _from_row(row), json_loads(row["secrets_json"], {})


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


def update_device_runtime_state(device_id: int, command_result: CommandResult) -> Device | None:
    if not command_result.ok:
        return get_device(device_id)
    dps = command_result.result.get("dps")
    if not isinstance(dps, dict) or not dps:
        return get_device(device_id)

    current = get_device(device_id)
    if not current:
        return None

    now = utc_now()
    current_dps = current.status.get("dps") if isinstance(current.status.get("dps"), dict) else {}
    merged_dps = {str(key): value for key, value in current_dps.items()}
    merged_dps.update({str(key): value for key, value in dps.items()})

    primary_dps_id = str(command_result.result.get("dpsId") or _primary_dps_id(current))
    current_value = merged_dps.get(primary_dps_id)
    status = {
        **current.status,
        "state": _state_from_value(current_value, current.device_type),
        "online": True,
        "lastSeenAt": now,
        "dps": merged_dps,
    }
    capabilities = {
        **current.capabilities,
        "status": _merge_status_entries(current.capabilities.get("status") or [], dps),
    }
    payload = {
        **current.payload,
        "lastStatus": merged_dps,
        "lastSeenAt": now,
    }
    with connect() as connection:
        connection.execute(
            """
            UPDATE devices
            SET status_json = ?, capabilities_json = ?, payload_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (json_dumps(status), json_dumps(capabilities), json_dumps(payload), now, device_id),
        )
    _update_entities_runtime_state(device_id, merged_dps, now)
    return get_device(device_id)


def auto_link_local_device(device_id: int) -> Device | None:
    item = get_device_with_secrets(device_id)
    if not item:
        return None
    device, secrets = item
    from src.app.modules.devices.local_link import find_local_match

    local = find_local_match(device, secrets)
    if not local:
        return device
    local_device_key = f"local:{local['ip']}:{device.external_id}"
    next_payload = {**device.payload, "local": local, "localDeviceKey": local_device_key}
    with connect() as connection:
        connection.execute(
            "UPDATE devices SET local_device_key = ?, payload_json = ?, updated_at = ? WHERE id = ?",
            (local_device_key, json_dumps(next_payload), utc_now(), device_id),
        )
    return get_device(device_id)


def auto_link_local_devices() -> list[Device]:
    return [device for device in (auto_link_local_device(device.id) for device in list_devices()) if device]


def log_device_command(device_id: int, request: CommandRequest, result: CommandResult) -> None:
    ensure_home_schema()
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO device_command_logs (device_id, command_json, result_json, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                device_id,
                json_dumps(_redact_secrets(request.model_dump())),
                json_dumps(result.model_dump(mode="json", by_alias=True)),
                result.status,
                utc_now(),
            ),
        )


def _redact_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        redacted = {}
        for key, item in value.items():
            if key.lower() in {"accesssecret", "localkey", "token", "secret", "password"}:
                redacted[key] = "***"
            else:
                redacted[key] = _redact_secrets(item)
        return redacted
    if isinstance(value, list):
        return [_redact_secrets(item) for item in value]
    return value


def _update_entities_runtime_state(device_id: int, dps: dict[str, Any], now: str) -> None:
    with connect() as connection:
        rows = connection.execute("SELECT * FROM entities WHERE device_id = ?", (device_id,)).fetchall()
        for row in rows:
            command_schema = json_loads(row["command_schema_json"], {})
            key = str(command_schema.get("switchCode") or row["unique_key"].rsplit(":", 1)[-1])
            dps_id = _dps_id_from_code(key)
            state = json_loads(row["state_json"], {})
            current_dps = state.get("dps") if isinstance(state.get("dps"), dict) else {}
            merged_dps = {str(code): value for code, value in current_dps.items()}
            merged_dps.update({str(code): value for code, value in dps.items()})
            value = merged_dps.get(dps_id)
            capabilities = json_loads(row["capabilities_json"], {})
            next_state = {
                **state,
                "value": value,
                "state": _state_from_value(value, row["type"]),
                "online": True,
                "lastSeenAt": now,
                "dps": merged_dps,
            }
            next_capabilities = {
                **capabilities,
                "status": _merge_status_entries(capabilities.get("status") or [], dps),
            }
            connection.execute(
                """
                UPDATE entities
                SET state_json = ?, capabilities_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (json_dumps(next_state), json_dumps(next_capabilities), now, row["id"]),
            )


def _merge_status_entries(current: list[Any], dps: dict[str, Any]) -> list[dict[str, Any]]:
    merged: dict[str, Any] = {}
    for item in current:
        if isinstance(item, dict) and item.get("code"):
            merged[str(item["code"])] = item.get("value")
    for dps_id, value in dps.items():
        merged[_code_from_dps_id(str(dps_id))] = value
    return [{"code": code, "value": value} for code, value in merged.items()]


def _primary_dps_id(device: Device) -> str:
    return _dps_id_from_code(str(device.capabilities.get("primarySwitchCode") or device.payload.get("primarySwitchCode") or "1"))


def _dps_id_from_code(code: str) -> str:
    if code.startswith("switch_") and code.removeprefix("switch_").isdigit():
        return code.removeprefix("switch_")
    if code in {"switch", "switch_led"}:
        return "1"
    return code


def _code_from_dps_id(dps_id: str) -> str:
    return f"switch_{dps_id}" if dps_id.isdigit() else dps_id


def _state_from_value(value: Any, device_type: str) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    if value in {"opening", "closing", "moving"}:
        return "on"
    if value in {"stop", "stopped", "idle"}:
        return "idle"
    if value is None and device_type in {"sensor", "camera"}:
        return "idle"
    return "unknown"


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
    return auto_link_local_device(device_id) or get_device(device_id)  # type: ignore[return-value]


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
