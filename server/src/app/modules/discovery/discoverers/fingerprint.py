from __future__ import annotations

from src.app.modules.discovery.discoverers.oui import lookup_manufacturer
from src.app.modules.discovery.schemas import DiscoveredDevice


def enrich_device(device: DiscoveredDevice) -> DiscoveredDevice:
    manufacturer = device.manufacturer or lookup_manufacturer(device.mac)
    device_type = device.device_type or _infer_device_type(device, manufacturer)
    confidence = _confidence(device, manufacturer, device_type)

    return device.model_copy(
        update={
            "manufacturer": manufacturer,
            "device_type": device_type,
            "confidence": confidence,
        }
    )


def _infer_device_type(device: DiscoveredDevice, manufacturer: str | None) -> str:
    service_blob = " ".join(
        " ".join(filter(None, [service.type, service.name, " ".join(map(str, service.properties.values()))]))
        for service in device.services
    ).lower()
    identity = " ".join(filter(None, [device.hostname, device.name, device.model, manufacturer])).lower()
    ports = set(device.open_ports)

    if "_printer" in service_blob or "printer" in identity:
        return "printer"
    if _has_any(service_blob + identity, ["googlecast", "mediarenderer", "dlna", "dial", "chromecast", "smart tv"]):
        return "media"
    if ports & {554, 8554} or _has_any(service_blob + identity, ["rtsp", "onvif", "hikvision", "dahua", "ip camera", "camera"]):
        return "camera"
    if _has_any(service_blob + identity, ["espressif", "arduino", "esphome", "_esphomelib", "_arduino", "_hap", "_matter"]):
        return "iot"
    if ports & {6053, 8266}:
        return "iot"
    if ports & {1883, 8883} or "_mqtt" in service_blob:
        return "iot"
    if ports & {53} and ports & {80, 443}:
        return "network"
    if _has_any(service_blob + identity, ["router", "gateway", "openwrt", "routeros", "tplink", "tp-link", "ubiquiti", "mikrotik"]):
        return "network"
    if _is_likely_mobile(device, manufacturer):
        return "mobile"
    return "unknown"


def _has_any(value: str, terms: list[str]) -> bool:
    return any(term in value for term in terms)


def _is_likely_mobile(device: DiscoveredDevice, manufacturer: str | None) -> bool:
    if device.services or device.open_ports:
        return False
    return _has_any((manufacturer or "").lower(), ["apple", "samsung", "xiaomi", "motorola"])


def _confidence(device: DiscoveredDevice, manufacturer: str | None, device_type: str) -> float:
    score = 0.2
    score += min(len(device.source), 3) * 0.12
    score += 0.18 if device.ip else 0
    score += 0.14 if device.mac else 0
    score += 0.1 if device.hostname else 0
    score += 0.08 if device.name else 0
    score += 0.06 if device.model else 0
    score += 0.14 if device.services else 0
    score += 0.1 if device.open_ports else 0
    score += 0.06 if manufacturer else 0
    score += 0.08 if device_type != "unknown" else -0.04
    return round(max(0.1, min(score, 0.98)), 2)
