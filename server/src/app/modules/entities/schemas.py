from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Entity(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    device_id: int = Field(alias="deviceId")
    unique_key: str = Field(alias="uniqueKey")
    type: str
    name: str
    command_schema: dict[str, Any] = Field(default_factory=dict, alias="commandSchema")
    state: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class CommandRequest(BaseModel):
    command: str
    params: dict[str, Any] = Field(default_factory=dict)


class CommandResult(BaseModel):
    ok: bool
    status: str
    message: str
    result: dict[str, Any] = Field(default_factory=dict)
