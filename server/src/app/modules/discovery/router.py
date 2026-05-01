from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response

from src.app.modules.discovery.jobs import create_discovery_job, run_discovery, run_discovery_job_sync
from src.app.modules.discovery.schemas import (
    CreateDiscoveryJobRequest,
    CreateDiscoveryJobResponse,
    DiscoveredDevice,
    DiscoveryJob,
    JobStatus,
    SavedDiscoveryDevice,
    SavedDiscoveryScan,
)
from src.app.modules.discovery.store import (
    create_scan_record,
    get_job,
    get_saved_scan,
    list_discovery_jobs,
    list_saved_devices,
    list_saved_scans,
    update_scan_record,
)

router = APIRouter()


@router.post("/jobs", response_model=CreateDiscoveryJobResponse, response_model_by_alias=True, response_model_exclude_none=True)
def create_job(request: CreateDiscoveryJobRequest, background_tasks: BackgroundTasks) -> CreateDiscoveryJobResponse:
    job = create_discovery_job(request)
    background_tasks.add_task(run_discovery_job_sync, job.id, request)
    return CreateDiscoveryJobResponse(job_id=job.id, status=job.status)


@router.get("/jobs", response_model=list[DiscoveryJob], response_model_by_alias=True, response_model_exclude_none=True)
def list_jobs() -> list[DiscoveryJob]:
    return list_discovery_jobs()


@router.get("/jobs/{job_id}", response_model=DiscoveryJob, response_model_by_alias=True, response_model_exclude_none=True)
def read_job(job_id: str) -> DiscoveryJob:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Discovery job not found")
    return job


@router.post("/scan", response_model=list[DiscoveredDevice], response_model_by_alias=True, response_model_exclude_none=True)
async def scan_now(request: CreateDiscoveryJobRequest, response: Response) -> list[DiscoveredDevice]:
    now = _now()
    scan_id = create_scan_record(request, status=JobStatus.running, created_at=now, started_at=now)
    response.headers["X-Discovery-Scan-Id"] = str(scan_id)

    try:
        result = await run_discovery(request)
        update_scan_record(scan_id, status=JobStatus.finished, result=result, finished_at=_now())
        return result
    except Exception as exc:
        update_scan_record(scan_id, status=JobStatus.failed, error=str(exc), finished_at=_now())
        raise


@router.get("/scans", response_model=list[SavedDiscoveryScan], response_model_by_alias=True, response_model_exclude_none=True)
def list_scans() -> list[SavedDiscoveryScan]:
    return list_saved_scans()


@router.get("/scans/{scan_id}", response_model=SavedDiscoveryScan, response_model_by_alias=True, response_model_exclude_none=True)
def read_scan(scan_id: int) -> SavedDiscoveryScan:
    scan = get_saved_scan(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Discovery scan not found")
    return scan


@router.get("/devices", response_model=list[SavedDiscoveryDevice], response_model_by_alias=True, response_model_exclude_none=True)
def list_devices() -> list[SavedDiscoveryDevice]:
    return list_saved_devices()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
