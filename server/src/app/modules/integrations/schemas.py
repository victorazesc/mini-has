from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.app.modules.inbox.schemas import InboxDevice


class IntegrationType(str, Enum):
    tuya_cloud = "tuya_cloud"
    tuya_local = "tuya_local"
    smartthings_cloud = "smartthings_cloud"
    intelbras_izy_tuya = "intelbras_izy_tuya"
    persiana_custom = "persiana_custom"
    generic_iot = "generic_iot"
    esphome = "esphome"
    onvif_camera = "onvif_camera"
    mqtt = "mqtt"


class IntegrationStatus(str, Enum):
    created = "created"
    connected = "connected"
    error = "error"
    syncing = "syncing"


class ProviderField(BaseModel):
    key: str
    label: str
    secret: bool = False
    required: bool = False
    default: Any = None
    help: str | None = None


class ProviderDefinition(BaseModel):
    type: IntegrationType
    name: str
    description: str
    status: str = "available"
    fields: list[ProviderField] = Field(default_factory=list)


class CreateIntegrationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: IntegrationType
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    test_on_create: bool = Field(default=True, alias="testOnCreate")


class Integration(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    type: IntegrationType
    name: str
    status: IntegrationStatus
    config: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    last_sync_at: str | None = Field(default=None, alias="lastSyncAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class StoredIntegration(Integration):
    secrets: dict[str, Any] = Field(default_factory=dict, exclude=True)


class IntegrationTestResult(BaseModel):
    ok: bool
    status: IntegrationStatus
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ProviderEntity(BaseModel):
    key: str
    type: str
    name: str
    command_schema: dict[str, Any] = Field(default_factory=dict, alias="commandSchema")
    state: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)


class ProviderDevice(BaseModel):
    external_id: str = Field(alias="externalId")
    name: str
    provider: str
    device_type: str = Field(alias="deviceType")
    manufacturer: str | None = None
    model: str | None = None
    ip: str | None = None
    mac: str | None = None
    product_key: str | None = Field(default=None, alias="productKey")
    local_device_key: str | None = Field(default=None, alias="localDeviceKey")
    capabilities: dict[str, Any] = Field(default_factory=dict)
    status: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict, exclude=True)
    entities: list[ProviderEntity] = Field(default_factory=list)


class IntegrationSyncResult(BaseModel):
    ok: bool
    integration_id: int = Field(alias="integrationId")
    imported: int
    inbox_ids: list[int] = Field(default_factory=list, alias="inboxIds")
    inbox_devices: list[InboxDevice] = Field(default_factory=list, alias="inboxDevices")
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
