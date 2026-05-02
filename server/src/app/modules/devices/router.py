from fastapi import APIRouter, HTTPException

from src.app.modules.devices.schema import Device, DeviceCreateRequest, DeviceUpdateRequest, LinkLocalDeviceRequest
from src.app.modules.devices.store import create_device, delete_device, get_device, link_local_device, list_devices, update_device

router = APIRouter()


@router.get("", response_model=list[Device], response_model_by_alias=True, response_model_exclude_none=True)
def read_devices() -> list[Device]:
    return list_devices()


@router.get("/{device_id}", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def read_device(device_id: int) -> Device:
    device = get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def create_device_route(request: DeviceCreateRequest) -> Device:
    return create_device(request)


@router.patch("/{device_id}", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def update_device_route(device_id: int, request: DeviceUpdateRequest) -> Device:
    device = update_device(device_id, request)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("/{device_id}/link-local", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def link_local_device_route(device_id: int, request: LinkLocalDeviceRequest) -> Device:
    device = link_local_device(device_id, request.local_device_key, request.payload)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.delete("/{device_id}")
def delete_device_route(device_id: int) -> dict[str, bool]:
    deleted = delete_device(device_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"deleted": True}
