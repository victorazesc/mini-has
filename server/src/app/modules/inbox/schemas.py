from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InboxStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    ignored = "ignored"


class InboxDevice(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    source_type: str = Field(alias="sourceType")
    source_id: int = Field(alias="sourceId")
    external_id: str = Field(alias="externalId")
    status: InboxStatus
    payload: dict[str, Any] = Field(default_factory=dict)
    match_score: float = Field(default=0, alias="matchScore")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AcceptInboxDeviceRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str | None = None
    room_id: int | None = Field(default=None, alias="roomId")
    create_entities: bool = Field(default=True, alias="createEntities")


class IgnoreInboxDeviceRequest(BaseModel):
    reason: str | None = None
