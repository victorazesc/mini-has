from fastapi import APIRouter
from src.app.modules.devices.schema import Device

router = APIRouter()


@router.get("/")
def get_devices():
    return {"devices": []}

@router.get("/{device_id}")
def get_device(device_id: str):
    return {"device": {}}

@router.post("/")
def create_device(device: Device):
    return {"device": {}}

@router.put("/{device_id}")
def update_device(device_id: str, device: Device):
    return {"device": {}}

@router.delete("/{device_id}")
def delete_device(device_id: str):
    return {"device": {}}