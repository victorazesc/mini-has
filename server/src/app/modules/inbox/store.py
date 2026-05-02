from __future__ import annotations

from typing import Any

from src.app.core.storage import connect, json_dumps, json_loads, utc_now
from src.app.modules.inbox.schemas import InboxDevice, InboxStatus
from src.app.modules.integrations.store import ensure_home_schema


def upsert_inbox_item(
    source_type: str,
    source_id: int,
    external_id: str,
    payload: dict[str, Any],
    secrets: dict[str, Any] | None = None,
    match_score: float = 0,
) -> int:
    ensure_home_schema()
    now = utc_now()
    secrets = secrets or {}
    with connect() as connection:
        existing = connection.execute(
            """
            SELECT id, status FROM device_inbox
            WHERE source_type = ? AND source_id = ? AND external_id = ?
            """,
            (source_type, source_id, external_id),
        ).fetchone()
        if existing:
            connection.execute(
                """
                UPDATE device_inbox
                SET payload_json = ?, secrets_json = ?, match_score = ?, updated_at = ?
                WHERE id = ?
                """,
                (json_dumps(payload), json_dumps(secrets), match_score, now, existing["id"]),
            )
            return int(existing["id"])

        cursor = connection.execute(
            """
            INSERT INTO device_inbox
                (source_type, source_id, external_id, status, payload_json, secrets_json, match_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (source_type, source_id, external_id, InboxStatus.pending.value, json_dumps(payload), json_dumps(secrets), match_score, now, now),
        )
        return int(cursor.lastrowid)


def list_inbox_devices(status: InboxStatus | None = None, provider: str | None = None) -> list[InboxDevice]:
    ensure_home_schema()
    sql = "SELECT * FROM device_inbox"
    params: tuple[Any, ...] = ()
    if status:
        sql += " WHERE status = ?"
        params = (status.value,)
    sql += " ORDER BY updated_at DESC, id DESC"
    with connect() as connection:
        rows = connection.execute(sql, params).fetchall()
    devices = [_from_row(row) for row in rows]
    if provider:
        normalized_provider = provider.strip()
        devices = [device for device in devices if str(device.payload.get("provider") or "").strip() == normalized_provider]
    return devices


def get_inbox_device(inbox_id: int) -> InboxDevice | None:
    row = _get_raw_inbox(inbox_id)
    return _from_row(row) if row else None


def get_inbox_payload_with_secrets(inbox_id: int) -> tuple[InboxDevice, dict[str, Any]] | None:
    row = _get_raw_inbox(inbox_id)
    if not row:
        return None
    return _from_row(row), json_loads(row["secrets_json"], {})


def mark_inbox_status(inbox_id: int, status: InboxStatus) -> InboxDevice | None:
    ensure_home_schema()
    with connect() as connection:
        connection.execute("UPDATE device_inbox SET status = ?, updated_at = ? WHERE id = ?", (status.value, utc_now(), inbox_id))
    return get_inbox_device(inbox_id)


def _get_raw_inbox(inbox_id: int):
    ensure_home_schema()
    with connect() as connection:
        return connection.execute("SELECT * FROM device_inbox WHERE id = ?", (inbox_id,)).fetchone()


def _from_row(row) -> InboxDevice:
    return InboxDevice(
        id=row["id"],
        sourceType=row["source_type"],
        sourceId=row["source_id"],
        externalId=row["external_id"],
        status=row["status"],
        payload=json_loads(row["payload_json"], {}),
        matchScore=row["match_score"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )
