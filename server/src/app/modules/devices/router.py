from fastapi import APIRouter, HTTPException

from src.app.modules.devices.commands import execute_device_command
from src.app.modules.devices.schema import Device, DeviceCreateRequest, DeviceUpdateRequest, LinkLocalDeviceRequest
from src.app.modules.devices.store import auto_link_local_device, auto_link_local_devices, create_device, delete_device, get_device, get_device_with_secrets, link_local_device, list_devices, log_device_command, update_device, update_device_runtime_state
from src.app.modules.entities.schemas import CommandRequest, CommandResult

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


@router.post("/auto-link-local", response_model=list[Device], response_model_by_alias=True, response_model_exclude_none=True)
def auto_link_local_devices_route() -> list[Device]:
    return auto_link_local_devices()


@router.post("/{device_id}/auto-link-local", response_model=Device, response_model_by_alias=True, response_model_exclude_none=True)
def auto_link_local_device_route(device_id: int) -> Device:
    device = auto_link_local_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("/{device_id}/command", response_model=CommandResult, response_model_by_alias=True)
def command_device(device_id: int, request: CommandRequest) -> CommandResult:
    item = get_device_with_secrets(device_id)
    if not item:
        raise HTTPException(status_code=404, detail="Device not found")
    device, secrets = item
    result = execute_device_command(device, secrets, request)
    update_device_runtime_state(device_id, result)
    log_device_command(device_id, request, result)
    return result


@router.delete("/{device_id}")
def delete_device_route(device_id: int) -> dict[str, bool]:
    deleted = delete_device(device_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"deleted": True}
