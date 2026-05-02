from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.app.modules.devices.schema import Device
from src.app.modules.devices.store import accept_inbox_device
from src.app.modules.entities.store import create_entities_for_device
from src.app.modules.inbox.schemas import AcceptInboxDeviceRequest, IgnoreInboxDeviceRequest, InboxDevice, InboxStatus
from src.app.modules.inbox.store import get_inbox_payload_with_secrets, list_inbox_devices, mark_inbox_status

router = APIRouter()


@router.get("/devices", response_model=list[InboxDevice], response_model_by_alias=True, response_model_exclude_none=True)
def read_inbox_devices(status: InboxStatus | None = None, provider: str | None = None) -> list[InboxDevice]:
    return list_inbox_devices(status, provider)


@router.post("/devices/{inbox_id}/accept", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def accept_inbox_device_route(inbox_id: int, request: AcceptInboxDeviceRequest) -> Device:
    item = get_inbox_payload_with_secrets(inbox_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inbox device not found")
    inbox, secrets = item
    device = accept_inbox_device(inbox, secrets, request.name, request.room_id)
    if request.create_entities:
        create_entities_for_device(device.id, device.provider, device.external_id, inbox.payload.get("entities") or [])
    mark_inbox_status(inbox_id, InboxStatus.accepted)
    return device


@router.post("/devices/{inbox_id}/ignore", response_model=InboxDevice, response_model_by_alias=True, response_model_exclude_none=True)
def ignore_inbox_device_route(inbox_id: int, request: IgnoreInboxDeviceRequest) -> InboxDevice:
    _ = request
    inbox = mark_inbox_status(inbox_id, InboxStatus.ignored)
    if not inbox:
        raise HTTPException(status_code=404, detail="Inbox device not found")
    return inbox
