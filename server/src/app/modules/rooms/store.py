from __future__ import annotations

from src.app.core.storage import connect, utc_now
from src.app.modules.integrations.store import ensure_home_schema
from src.app.modules.rooms.schemas import Room, RoomRequest, RoomUpdateRequest


def list_rooms() -> list[Room]:
    ensure_home_schema()
    with connect() as connection:
        rows = connection.execute("SELECT * FROM rooms ORDER BY name").fetchall()
    return [_from_row(row) for row in rows]


def get_room(room_id: int) -> Room | None:
    ensure_home_schema()
    with connect() as connection:
        row = connection.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
    return _from_row(row) if row else None


def create_room(request: RoomRequest) -> Room:
    ensure_home_schema()
    now = utc_now()
    with connect() as connection:
        cursor = connection.execute(
            "INSERT INTO rooms (name, icon, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (request.name, request.icon, request.description, now, now),
        )
        room_id = int(cursor.lastrowid)
    return get_room(room_id)  # type: ignore[return-value]


def update_room(room_id: int, request: RoomUpdateRequest) -> Room | None:
    ensure_home_schema()
    current = get_room(room_id)
    if not current:
        return None

    updates = request.model_dump(exclude_unset=True)
    field_map = {
        "name": "name",
        "icon": "icon",
        "description": "description",
    }
    assignments = []
    values = []

    for source, target in field_map.items():
        if source in updates:
            assignments.append(f"{target} = ?")
            values.append(updates[source])

    if not assignments:
        return current

    assignments.append("updated_at = ?")
    values.extend([utc_now(), room_id])

    with connect() as connection:
        connection.execute(
            f"UPDATE rooms SET {', '.join(assignments)} WHERE id = ?",
            values,
        )

    return get_room(room_id)


def delete_room(room_id: int) -> bool:
    ensure_home_schema()
    with connect() as connection:
        connection.execute("UPDATE devices SET room_id = NULL WHERE room_id = ?", (room_id,))
        cursor = connection.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
    return cursor.rowcount > 0


def _from_row(row) -> Room:
    return Room(
        id=row["id"],
        name=row["name"],
        icon=row["icon"],
        description=row["description"],
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
    )
