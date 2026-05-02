from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Device(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    integration_id: int | None = Field(default=None, alias="integrationId")
    inbox_id: int | None = Field(default=None, alias="inboxId")
    external_id: str = Field(alias="externalId")
    local_device_key: str | None = Field(default=None, alias="localDeviceKey")
    name: str
    device_type: str = Field(alias="deviceType")
    provider: str
    room_id: int | None = Field(default=None, alias="roomId")
    room_name: str | None = Field(default=None, alias="roomName")
    payload: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    status: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class DeviceCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    external_id: str = Field(alias="externalId")
    name: str
    device_type: str = Field(default="unknown", alias="deviceType")
    provider: str = "manual"
    room_id: int | None = Field(default=None, alias="roomId")
    local_device_key: str | None = Field(default=None, alias="localDeviceKey")
    payload: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    status: dict[str, Any] = Field(default_factory=dict)


class DeviceUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    device_type: str | None = Field(default=None, alias="deviceType")
    room_id: int | None = Field(default=None, alias="roomId")
    local_device_key: str | None = Field(default=None, alias="localDeviceKey")
    payload: dict[str, Any] | None = None
    capabilities: dict[str, Any] | None = None
    status: dict[str, Any] | None = None


class LinkLocalDeviceRequest(BaseModel):
    local_device_key: str = Field(alias="localDeviceKey")
    payload: dict[str, Any] = Field(default_factory=dict)
