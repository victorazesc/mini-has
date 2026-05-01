from __future__ import annotations

import socket
import time
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen
from xml.etree import ElementTree

SSDP_TARGET = ("239.255.255.250", 1900)


def discover_ssdp(timeout: float = 3.0) -> list[dict[str, Any]]:
    request = "\r\n".join(
        [
            "M-SEARCH * HTTP/1.1",
            "HOST: 239.255.255.250:1900",
            'MAN: "ssdp:discover"',
            "MX: 2",
            "ST: ssdp:all",
            "",
            "",
        ]
    ).encode()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.settimeout(0.25)
    devices: dict[str, dict[str, Any]] = {}

    try:
        sock.sendto(request, SSDP_TARGET)
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                continue

            headers = _parse_headers(data)
            location = headers.get("location")
            st = headers.get("st") or headers.get("nt")
            parsed = urlparse(location or "")
            ip = parsed.hostname or addr[0]
            port = parsed.port or (443 if parsed.scheme == "https" else 80 if parsed.scheme == "http" else None)

            details = _fetch_device_description(location) if location else {}
            device = devices.setdefault(
                ip,
                {
                    "ip": ip,
                    "hostname": parsed.hostname if parsed.hostname != ip else None,
                    "source": ["ssdp"],
                    "services": [],
                    "raw": {"ssdp": []},
                },
            )

            if details.get("name"):
                device["name"] = details["name"]
            if details.get("manufacturer"):
                device["manufacturer"] = details["manufacturer"]
            if details.get("model"):
                device["model"] = details["model"]
            if details.get("device_type"):
                device["deviceType"] = details["device_type"]

            device["services"].append({"type": st, "port": port, "properties": {"location": location}})
            device["raw"]["ssdp"].append(headers)
    finally:
        sock.close()

    return list(devices.values())


def _parse_headers(data: bytes) -> dict[str, str]:
    lines = data.decode(errors="ignore").splitlines()
    headers: dict[str, str] = {}

    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()

    return headers


def _fetch_device_description(location: str) -> dict[str, str]:
    try:
        with urlopen(location, timeout=1.5) as response:
            body = response.read(200_000)
    except Exception:
        return {}

    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return {}

    def text(tag: str) -> str | None:
        node = root.find(f".//{{*}}{tag}")
        return node.text.strip() if node is not None and node.text else None

    return {
        "name": text("friendlyName") or "",
        "manufacturer": text("manufacturer") or "",
        "model": " ".join(filter(None, [text("modelName"), text("modelNumber")]))[:120],
        "device_type": _map_ssdp_device_type(text("deviceType") or ""),
    }


def _map_ssdp_device_type(device_type: str) -> str:
    lowered = device_type.lower()
    if "mediarenderer" in lowered or "dial" in lowered or "tv" in lowered:
        return "media"
    if "camera" in lowered:
        return "camera"
    if "printer" in lowered:
        return "printer"
    if "internetgatewaydevice" in lowered or "router" in lowered:
        return "network"
    return "iot" if device_type else ""
