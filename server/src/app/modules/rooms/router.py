from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.app.modules.rooms.schemas import Room, RoomRequest, RoomUpdateRequest
from src.app.modules.rooms.store import create_room, delete_room, get_room, list_rooms, update_room

router = APIRouter()


@router.get("", response_model=list[Room], response_model_by_alias=True, response_model_exclude_none=True)
def read_rooms() -> list[Room]:
    return list_rooms()


@router.get("/{room_id}", response_model=Room, response_model_by_alias=True, response_model_exclude_none=True)
def read_room(room_id: int) -> Room:
    room = get_room(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.post("", response_model=Room, response_model_by_alias=True, response_model_exclude_none=True)
def create_room_route(request: RoomRequest) -> Room:
    return create_room(request)


@router.patch("/{room_id}", response_model=Room, response_model_by_alias=True, response_model_exclude_none=True)
def update_room_route(room_id: int, request: RoomUpdateRequest) -> Room:
    room = update_room(room_id, request)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.delete("/{room_id}")
def delete_room_route(room_id: int) -> dict[str, bool]:
    deleted = delete_room(room_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"deleted": True}
