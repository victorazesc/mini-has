from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from src.app.modules.discovery.schemas import (
    CreateDiscoveryJobRequest,
    DiscoveredDevice,
    DiscoveryJob,
    JobStatus,
    SavedDiscoveryDevice,
    SavedDiscoveryScan,
)

DB_PATH = Path(os.getenv("MINI_HAS_DB", "data/mini-has.db"))

jobs: dict[str, DiscoveryJob] = {}
_initialized = False


def create_scan_record(
    request: CreateDiscoveryJobRequest,
    status: JobStatus,
    created_at: str,
    started_at: str | None = None,
) -> int:
    with _connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO discovery_scans (status, request_json, result_json, created_at, started_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (status.value, _json(request.model_dump(mode="json", by_alias=True, exclude_none=True)), "[]", created_at, started_at),
        )
        return int(cursor.lastrowid)


def save_job(job: DiscoveryJob) -> DiscoveryJob:
    jobs[job.id] = job
    return job


def get_job(job_id: str) -> DiscoveryJob | None:
    if job_id in jobs:
        return jobs[job_id]

    scan = get_saved_scan(_to_int(job_id))
    if not scan:
        return None

    return DiscoveryJob(
        id=str(scan.id),
        status=scan.status,
        result=scan.result,
        error=scan.error,
        created_at=scan.created_at,
        started_at=scan.started_at,
        finished_at=scan.finished_at,
        progress=1 if scan.status == JobStatus.finished else 0,
    )


def list_discovery_jobs() -> list[DiscoveryJob]:
    return [
        DiscoveryJob(
            id=str(scan.id),
            status=scan.status,
            result=scan.result,
            error=scan.error,
            created_at=scan.created_at,
            started_at=scan.started_at,
            finished_at=scan.finished_at,
            progress=1 if scan.status == JobStatus.finished else 0,
        )
        for scan in list_saved_scans()
    ]


def update_job(job_id: str, **kwargs) -> DiscoveryJob | None:
    job = get_job(job_id)
    scan_id = _to_int(job_id)

    if scan_id is not None:
        update_scan_record(scan_id, **kwargs)

    if not job:
        return None

    updated = job.model_copy(update=kwargs)
    jobs[job_id] = updated
    return updated


def update_scan_record(scan_id: int, **kwargs) -> SavedDiscoveryScan | None:
    fields: dict[str, Any] = {}

    if "status" in kwargs:
        status = kwargs["status"]
        fields["status"] = status.value if isinstance(status, JobStatus) else str(status)
    if "result" in kwargs:
        fields["result_json"] = _devices_json(kwargs["result"])
    if "error" in kwargs:
        fields["error"] = kwargs["error"]
    if "started_at" in kwargs:
        fields["started_at"] = kwargs["started_at"]
    if "finished_at" in kwargs:
        fields["finished_at"] = kwargs["finished_at"]

    if fields:
        assignments = ", ".join(f"{name} = ?" for name in fields)
        values = [*fields.values(), scan_id]
        with _connect() as connection:
            connection.execute(f"UPDATE discovery_scans SET {assignments} WHERE id = ?", values)

    result = kwargs.get("result")
    if result:
        finished_at = kwargs.get("finished_at") or kwargs.get("started_at")
        if finished_at:
            save_discovered_devices(scan_id, result, finished_at)

    return get_saved_scan(scan_id)


def get_saved_scan(scan_id: int | None) -> SavedDiscoveryScan | None:
    if scan_id is None:
        return None
    with _connect() as connection:
        row = connection.execute("SELECT * FROM discovery_scans WHERE id = ?", (scan_id,)).fetchone()
    return _scan_from_row(row) if row else None


def list_saved_scans(limit: int = 100) -> list[SavedDiscoveryScan]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM discovery_scans ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_scan_from_row(row) for row in rows]


def save_discovered_devices(scan_id: int, devices: list[DiscoveredDevice], seen_at: str) -> None:
    inbox_items: list[tuple[str, DiscoveredDevice]] = []
    with _connect() as connection:
        for device in devices:
            key = _device_key(device)
            if not key:
                continue
            connection.execute(
                """
                INSERT INTO discovery_devices (device_key, payload_json, first_seen_at, last_seen_at, last_scan_id)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(device_key) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    last_seen_at = excluded.last_seen_at,
                    last_scan_id = excluded.last_scan_id
                """,
                (key, _device_json(device), seen_at, seen_at, scan_id),
            )
            inbox_items.append((key, device))

    for key, device in inbox_items:
        _upsert_discovery_inbox(scan_id, key, device)


def list_saved_devices() -> list[SavedDiscoveryDevice]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM discovery_devices ORDER BY id").fetchall()
    return [
        SavedDiscoveryDevice(
            id=row["id"],
            lastScanId=row["last_scan_id"],
            firstSeenAt=row["first_seen_at"],
            lastSeenAt=row["last_seen_at"],
            device=DiscoveredDevice.model_validate(_loads(row["payload_json"], {})),
        )
        for row in rows
    ]


def _connect() -> sqlite3.Connection:
    _ensure_db()
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def _ensure_db() -> None:
    global _initialized
    if _initialized:
        return

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH, timeout=10) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS discovery_scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,
                request_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS discovery_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_key TEXT NOT NULL UNIQUE,
                payload_json TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                last_scan_id INTEGER,
                FOREIGN KEY(last_scan_id) REFERENCES discovery_scans(id)
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_discovery_scans_created_at ON discovery_scans(created_at)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_discovery_devices_last_seen_at ON discovery_devices(last_seen_at)")

    _initialized = True


def _scan_from_row(row: sqlite3.Row) -> SavedDiscoveryScan:
    return SavedDiscoveryScan(
        id=row["id"],
        status=row["status"],
        request=_loads(row["request_json"], {}),
        result=[DiscoveredDevice.model_validate(item) for item in _loads(row["result_json"], [])],
        error=row["error"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def _device_key(device: DiscoveredDevice) -> str | None:
    if device.mac:
        return f"mac:{device.mac.upper()}"
    if device.ip:
        return f"ip:{device.ip}"
    if device.hostname:
        return f"host:{device.hostname.lower()}"
    return None


def _devices_json(devices: list[DiscoveredDevice]) -> str:
    return _json([device.model_dump(mode="json", by_alias=True, exclude_none=True) for device in devices])


def _device_json(device: DiscoveredDevice) -> str:
    return _json(device.model_dump(mode="json", by_alias=True, exclude_none=True))


def _upsert_discovery_inbox(scan_id: int, key: str, device: DiscoveredDevice) -> None:
    try:
        from src.app.modules.inbox.store import upsert_inbox_item

        payload = device.model_dump(mode="json", by_alias=True, exclude_none=True)
        payload.update(
            {
                "externalId": key,
                "provider": "discovery",
                "localDeviceKey": key,
                "scanId": scan_id,
            }
        )
        upsert_inbox_item(
            source_type="discovery",
            source_id=0,
            external_id=key,
            payload=payload,
            match_score=device.confidence,
        )
    except Exception:
        return


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _to_int(value: str | int | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
