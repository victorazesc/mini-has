from __future__ import annotations

import asyncio
import ipaddress
from datetime import datetime, timezone

from src.app.modules.discovery.discoverers.arp import discover_arp
from src.app.modules.discovery.discoverers.fingerprint import enrich_device
from src.app.modules.discovery.discoverers.mdns import discover_mdns
from src.app.modules.discovery.discoverers.ports import scan_open_ports
from src.app.modules.discovery.discoverers.probes import probe_devices
from src.app.modules.discovery.discoverers.ssdp import discover_ssdp
from src.app.modules.discovery.schemas import (
    CreateDiscoveryJobRequest,
    DiscoveredDevice,
    DiscoveredService,
    DiscoveryJob,
    JobStatus,
)
from src.app.modules.discovery.store import create_scan_record, save_job, update_job


def create_discovery_job(request: CreateDiscoveryJobRequest) -> DiscoveryJob:
    now = _now()
    scan_id = create_scan_record(request, status=JobStatus.pending, created_at=now)
    job = DiscoveryJob(id=str(scan_id), status=JobStatus.pending, created_at=now)
    save_job(job)
    return job


async def run_discovery(request: CreateDiscoveryJobRequest) -> list[DiscoveredDevice]:
    mdns_task = asyncio.to_thread(discover_mdns, request.timeout_seconds)
    ssdp_task = asyncio.to_thread(discover_ssdp, request.timeout_seconds)
    arp_task = discover_arp(request.subnet_prefix, timeout=0.8)

    mdns_results, ssdp_results, arp_results = await asyncio.gather(mdns_task, ssdp_task, arp_task)
    devices = _filter_valid_devices(_merge_results([*mdns_results, *ssdp_results, *arp_results]), request.subnet_prefix)

    if request.scan_ports:
        ips = [device.ip for device in devices if device.ip]
        ports_by_ip = await scan_open_ports(ips, request.ports)
        devices = [_merge_open_ports(device, ports_by_ip.get(device.ip or "", [])) for device in devices]

    devices = _filter_valid_devices(await probe_devices(devices, request.probe_mode), request.subnet_prefix)
    return sorted((enrich_device(device) for device in devices), key=_sort_key)


async def run_discovery_job(job_id: str, request: CreateDiscoveryJobRequest) -> None:
    update_job(job_id, status=JobStatus.running, started_at=_now(), progress=0.05)

    try:
        result = await run_discovery(request)
        update_job(
            job_id,
            status=JobStatus.finished,
            progress=1,
            result=result,
            finished_at=_now(),
        )
    except Exception as exc:
        update_job(job_id, status=JobStatus.failed, error=str(exc), finished_at=_now())


def run_discovery_job_sync(job_id: str, request: CreateDiscoveryJobRequest) -> None:
    asyncio.run(run_discovery_job(job_id, request))


def _merge_results(items: list[dict]) -> list[DiscoveredDevice]:
    devices: dict[str, DiscoveredDevice] = {}

    for item in items:
        normalized = _to_device(item)
        key = _find_existing_key(devices, normalized) or _device_key(normalized)
        existing = devices.get(key)
        devices[key] = _merge_device(existing, normalized) if existing else normalized

    return list(devices.values())


def _to_device(item: dict) -> DiscoveredDevice:
    return DiscoveredDevice.model_validate(item)


def _device_key(device: DiscoveredDevice) -> str:
    if device.mac:
        return f"mac:{device.mac.upper()}"
    if device.ip:
        return f"ip:{device.ip}"
    if device.hostname:
        return f"host:{device.hostname.lower()}"
    return f"unknown:{id(device)}"


def _find_existing_key(devices: dict[str, DiscoveredDevice], device: DiscoveredDevice) -> str | None:
    for key, current in devices.items():
        if device.mac and current.mac and device.mac.upper() == current.mac.upper():
            return key
        if device.ip and current.ip and device.ip == current.ip:
            return key
        if device.hostname and current.hostname and device.hostname.lower() == current.hostname.lower():
            return key
    return None


def _merge_device(left: DiscoveredDevice | None, right: DiscoveredDevice) -> DiscoveredDevice:
    if not left:
        return right

    return left.model_copy(
        update={
            "ip": left.ip or right.ip,
            "hostname": left.hostname or right.hostname,
            "mac": _normalize_mac(left.mac or right.mac),
            "name": left.name or right.name,
            "manufacturer": left.manufacturer or right.manufacturer,
            "model": left.model or right.model,
            "device_type": left.device_type or right.device_type,
            "source": sorted(set(left.source + right.source)),
            "services": _merge_services(left.services, right.services),
            "open_ports": sorted(set(left.open_ports + right.open_ports)),
            "raw": {**left.raw, **right.raw},
        }
    )


def _merge_services(left: list[DiscoveredService], right: list[DiscoveredService]) -> list[DiscoveredService]:
    services: dict[tuple[str | None, int | None, str | None], DiscoveredService] = {}
    for service in [*left, *right]:
        services[(service.type, service.port, service.name)] = service
    return list(services.values())


def _merge_open_ports(device: DiscoveredDevice, ports: list[int]) -> DiscoveredDevice:
    if not ports:
        return device
    return device.model_copy(update={"open_ports": sorted(set(device.open_ports + ports))})


def _filter_valid_devices(devices: list[DiscoveredDevice], subnet_prefix: str) -> list[DiscoveredDevice]:
    return [device for device in devices if _is_valid_device(device, subnet_prefix)]


def _is_valid_device(device: DiscoveredDevice, subnet_prefix: str) -> bool:
    if not (device.ip or device.hostname or device.mac):
        return False
    if _is_broadcast_mac(device.mac):
        return False
    if not device.ip:
        return True
    try:
        ip = ipaddress.ip_address(device.ip)
    except ValueError:
        return False
    if ip.version == 4 and device.ip.endswith(".255"):
        return False
    if "/" in subnet_prefix:
        network = ipaddress.ip_network(subnet_prefix, strict=False)
        return ip.version == network.version and ip in network and ip != network.broadcast_address
    if ip.version != 4:
        return False
    return device.ip.startswith(subnet_prefix.rstrip(".") + ".")


def _is_broadcast_mac(mac: str | None) -> bool:
    return bool(mac) and mac.upper() == "FF:FF:FF:FF:FF:FF"


def _sort_key(device: DiscoveredDevice) -> tuple[int, int, str]:
    if device.ip:
        try:
            return (0, int(ipaddress.ip_address(device.ip)), device.hostname or "")
        except ValueError:
            pass
    return (1, 0, device.hostname or device.name or "")


def _normalize_mac(mac: str | None) -> str | None:
    return mac.upper() if mac else None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
