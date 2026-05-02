from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.app.modules.entities.schemas import CommandRequest, CommandResult, Entity
from src.app.modules.entities.store import get_entity, list_entities, log_command

router = APIRouter()


@router.get("", response_model=list[Entity], response_model_by_alias=True, response_model_exclude_none=True)
def read_entities() -> list[Entity]:
    return list_entities()


@router.get("/{entity_id}", response_model=Entity, response_model_by_alias=True, response_model_exclude_none=True)
def read_entity(entity_id: int) -> Entity:
    entity = get_entity(entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity


@router.post("/{entity_id}/command", response_model=CommandResult, response_model_by_alias=True)
def command_entity(entity_id: int, request: CommandRequest) -> CommandResult:
    result = log_command(entity_id, request)
    if not result:
        raise HTTPException(status_code=404, detail="Entity not found")
    return result
