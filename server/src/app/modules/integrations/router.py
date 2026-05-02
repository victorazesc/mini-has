from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.app.core.storage import utc_now
from src.app.modules.inbox.store import get_inbox_device, upsert_inbox_item
from src.app.modules.integrations.providers import list_provider_definitions, split_provider_config, sync_provider, test_provider
from src.app.modules.integrations.schemas import (
    CreateIntegrationRequest,
    Integration,
    IntegrationStatus,
    IntegrationSyncResult,
    IntegrationTestResult,
    IntegrationType,
    ProviderDefinition,
    StoredIntegration,
)
from src.app.modules.integrations.store import (
    create_integration,
    delete_integration,
    find_integration_by_config_value,
    get_integration,
    list_integrations,
    update_integration_status,
)

router = APIRouter()
providers_router = APIRouter()


@providers_router.get("", response_model=list[ProviderDefinition], response_model_by_alias=True, response_model_exclude_none=True)
def read_provider_definitions() -> list[ProviderDefinition]:
    return list_provider_definitions()


@router.get("", response_model=list[Integration], response_model_by_alias=True, response_model_exclude_none=True)
def read_integrations() -> list[Integration]:
    return list_integrations()


@router.get("/{integration_id}", response_model=Integration, response_model_by_alias=True, response_model_exclude_none=True)
def read_integration(integration_id: int) -> Integration:
    integration = get_integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    return integration


@router.post("", response_model=Integration, response_model_by_alias=True, response_model_exclude_none=True)
def create_integration_route(request: CreateIntegrationRequest) -> Integration:
    config, secrets = split_provider_config(request.type, request.config)
    if request.type == IntegrationType.tuya_cloud:
        access_id = str(config.get("accessId") or "").strip()
        if access_id:
            config["accessId"] = access_id
        if find_integration_by_config_value(request.type, "accessId", access_id):
            raise HTTPException(status_code=409, detail="Ja existe uma integracao Tuya Cloud com este Access ID.")

    status = IntegrationStatus.created
    if request.test_on_create:
        now = utc_now()
        pending = StoredIntegration(
            id=0,
            type=request.type,
            name=request.name,
            status=IntegrationStatus.created,
            config=config,
            secrets=secrets,
            createdAt=now,
            updatedAt=now,
        )
        result = test_provider(pending)
        if not result.ok:
            raise HTTPException(status_code=400, detail=result.message)
        status = result.status

    return create_integration(request, config, secrets, status)


@router.post("/{integration_id}/test", response_model=IntegrationTestResult, response_model_by_alias=True)
def test_integration_route(integration_id: int) -> IntegrationTestResult:
    integration = get_integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    result = test_provider(integration)
    update_integration_status(integration_id, result.status, None if result.ok else result.message)
    return result


@router.post("/{integration_id}/sync", response_model=IntegrationSyncResult, response_model_by_alias=True)
def sync_integration_route(integration_id: int) -> IntegrationSyncResult:
    integration = get_integration(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    update_integration_status(integration_id, IntegrationStatus.syncing)
    try:
        devices, details = sync_provider(integration)
        inbox_ids = []
        inbox_devices = []
        for device in devices:
            payload = device.model_dump(mode="json", by_alias=True, exclude_none=True)
            inbox_id = upsert_inbox_item(
                source_type="integration",
                source_id=integration_id,
                external_id=device.external_id,
                payload=payload,
                secrets=device.secrets,
                match_score=0.75 if device.ip else 0.5,
            )
            inbox_ids.append(inbox_id)
            inbox_device = get_inbox_device(inbox_id)
            if inbox_device:
                inbox_devices.append(inbox_device)
        update_integration_status(integration_id, IntegrationStatus.connected, last_sync_at=utc_now())
        return IntegrationSyncResult(
            ok=True,
            integrationId=integration_id,
            imported=len(inbox_ids),
            inboxIds=inbox_ids,
            inboxDevices=inbox_devices,
            message="Sync concluido.",
            details=details,
        )
    except Exception as exc:
        update_integration_status(integration_id, IntegrationStatus.error, str(exc))
        return IntegrationSyncResult(ok=False, integrationId=integration_id, imported=0, inboxIds=[], message=str(exc))


@router.delete("/{integration_id}")
def delete_integration_route(integration_id: int) -> dict[str, bool]:
    deleted = delete_integration(integration_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Integration not found")
    return {"deleted": True}
