from __future__ import annotations

import ipaddress
from typing import Any

from src.app.core.storage import connect, json_loads, utc_now
from src.app.modules.devices.schema import Device
from src.app.modules.devices.tuya_lan import DEFAULT_PORT, TuyaLanClient


def find_local_match(device: Device, secrets: dict[str, Any]) -> dict[str, Any] | None:
    discoveries = _list_discoveries()
    passive = _passive_match(device, discoveries)
    if passive:
        return passive
    if device.provider in {"tuya_cloud", "tuya_local", "intelbras_izy_tuya"}:
        return _tuya_lan_probe_match(device, secrets, discoveries)
    return None


def _passive_match(device: Device, discoveries: list[dict[str, Any]]) -> dict[str, Any] | None:
    target_ip = _private_ip(_first_non_empty(_nested(device.payload, "payload", "raw", "last_ip"), _nested(device.payload, "payload", "raw", "ip"), device.payload.get("ip")))
    target_mac = str(_first_non_empty(device.payload.get("mac"), _nested(device.payload, "payload", "raw", "mac")) or "").upper()
    for discovery in discoveries:
        if target_ip and discovery.get("ip") == target_ip:
            return _local_payload(device, discovery, "ip")
        if target_mac and str(discovery.get("mac") or "").upper() == target_mac:
            return _local_payload(device, discovery, "mac")
    return None


def _tuya_lan_probe_match(device: Device, secrets: dict[str, Any], discoveries: list[dict[str, Any]]) -> dict[str, Any] | None:
    local_key = str(secrets.get("localKey") or "").strip()
    if len(local_key) != 16:
        return None
    cid = _tuya_cid(device)
    for discovery in _tuya_candidates(discoveries):
        ip = discovery.get("ip")
        if not ip:
            continue
        try:
            with TuyaLanClient(ip, device.external_id, local_key, DEFAULT_PORT, 900) as client:
                client.query_status(cid)
            return _local_payload(device, discovery, "tuya_lan_probe", cid=cid)
        except Exception:
            continue
    return None


def _local_payload(device: Device, discovery: dict[str, Any], match_method: str, cid: str | None = None) -> dict[str, Any]:
    local: dict[str, Any] = {
        "ip": discovery.get("ip"),
        "mac": discovery.get("mac"),
        "source": "discovery",
        "matchMethod": match_method,
        "discoveryDeviceKey": discovery.get("deviceKey"),
        "matchedAt": utc_now(),
    }
    if device.provider in {"tuya_cloud", "tuya_local", "intelbras_izy_tuya"}:
        local.update(
            {
                "deviceId": device.external_id,
                "cid": cid or _tuya_cid(device),
                "port": DEFAULT_PORT,
                "primaryDpsId": _tuya_primary_dps_id(device),
                "version": "3.4",
            }
        )
    return {key: value for key, value in local.items() if value not in (None, "")}


def _list_discoveries() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT device_key, payload_json FROM discovery_devices ORDER BY last_seen_at DESC, id DESC").fetchall()
    discoveries = []
    for row in rows:
        payload = json_loads(row["payload_json"], {})
        payload["deviceKey"] = row["device_key"]
        discoveries.append(payload)
    return discoveries


def _tuya_candidates(discoveries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for discovery in discoveries:
        ip = _private_ip(discovery.get("ip"))
        if not ip:
            continue
        manufacturer = str(discovery.get("manufacturer") or "").lower()
        if "tuya" in manufacturer or "sji" in manufacturer:
            candidates.append(discovery)
    return candidates


def _tuya_cid(device: Device) -> str | None:
    raw = _nested(device.payload, "payload", "raw") or {}
    return _first_non_empty(_nested(device.payload, "local", "cid"), raw.get("node_id"), raw.get("uuid") if raw.get("sub") is True else None)


def _tuya_primary_dps_id(device: Device) -> str:
    code = str(_first_non_empty(_nested(device.payload, "local", "primaryDpsId"), device.capabilities.get("primarySwitchCode"), device.payload.get("primarySwitchCode")) or "1")
    if code.startswith("switch_") and code.removeprefix("switch_").isdigit():
        return code.removeprefix("switch_")
    if code in {"switch", "switch_led"}:
        return "1"
    return code


def _private_ip(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return None
    return text if ip.is_private else None


def _nested(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None
