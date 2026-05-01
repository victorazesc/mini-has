from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    finished = "finished"
    failed = "failed"


class ProbeMode(str, Enum):
    light = "light"
    balanced = "balanced"
    aggressive = "aggressive"


class CreateDiscoveryJobRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    subnet_prefix: str = Field(default="192.168.0")
    scan_ports: bool = True
    timeout_seconds: float = Field(default=3.0, ge=1.0, le=15.0)
    probe_mode: ProbeMode = Field(default=ProbeMode.aggressive, alias="probeMode")
    ports: list[int] | None = None


class DiscoveredService(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: str | None = None
    port: int | None = None
    name: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class DiscoveredDevice(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    ip: str | None = None
    hostname: str | None = None
    mac: str | None = None
    name: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    device_type: str | None = Field(default=None, alias="deviceType")
    source: list[str] = Field(default_factory=list)
    services: list[DiscoveredService] = Field(default_factory=list)
    open_ports: list[int] = Field(default_factory=list, alias="openPorts")
    confidence: float = 0.0
    raw: dict[str, Any] = Field(default_factory=dict, exclude=True)


class DiscoveryJob(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    status: JobStatus
    progress: float = 0
    result: list[DiscoveredDevice] = Field(default_factory=list)
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


class CreateDiscoveryJobResponse(BaseModel):
    job_id: str
    status: JobStatus


class SavedDiscoveryScan(BaseModel):
    id: int
    status: JobStatus
    request: dict[str, Any] = Field(default_factory=dict)
    result: list[DiscoveredDevice] = Field(default_factory=list)
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


class SavedDiscoveryDevice(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    last_scan_id: int | None = Field(default=None, alias="lastScanId")
    first_seen_at: str = Field(alias="firstSeenAt")
    last_seen_at: str = Field(alias="lastSeenAt")
    device: DiscoveredDevice
