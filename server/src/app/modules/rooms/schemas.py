from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Room(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    description: str | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class RoomRequest(BaseModel):
    name: str
    description: str | None = None
