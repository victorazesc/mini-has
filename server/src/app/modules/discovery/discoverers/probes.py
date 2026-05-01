from __future__ import annotations

import asyncio
import re
import socket
import ssl
from html import unescape
from typing import Any

from src.app.modules.discovery.schemas import DiscoveredDevice, DiscoveredService, ProbeMode

HTTP_PORTS = {80, 81, 5000, 8000, 8008, 8009, 8080, 8123, 8266, 9000}
HTTPS_PORTS = {443}
RTSP_PORTS = {554, 8554}


async def probe_devices(devices: list[DiscoveredDevice], probe_mode: ProbeMode) -> list[DiscoveredDevice]:
    if probe_mode == ProbeMode.light:
        return [_with_reverse_dns(device) for device in devices]

    semaphore = asyncio.Semaphore(64 if probe_mode == ProbeMode.aggressive else 24)

    async def probe(device: DiscoveredDevice) -> DiscoveredDevice:
        async with semaphore:
            return await _probe_device(device, probe_mode)

    return await asyncio.gather(*(probe(device) for device in devices))


async def _probe_device(device: DiscoveredDevice, probe_mode: ProbeMode) -> DiscoveredDevice:
    if not device.ip:
        return device

    updates: dict[str, Any] = {}
    services = list(device.services)
    raw = dict(device.raw)

    hostname = await asyncio.to_thread(_reverse_dns, device.ip)
    probed = False
    if hostname and not device.hostname:
        updates["hostname"] = hostname

    http_ports = sorted(set(device.open_ports) & (HTTP_PORTS | HTTPS_PORTS))
    if probe_mode == ProbeMode.balanced:
        http_ports = [port for port in http_ports if port in {80, 443, 8080, 8123, 8266}]

    http_results = await asyncio.gather(*(_probe_http(device.ip, port) for port in http_ports))
    for result in http_results:
        if not result:
            continue
        probed = True
        raw.setdefault("probes", []).append(result)
        services.append(_service_from_http(result))
        _merge_probe_identity(updates, result)

    rtsp_ports = sorted(set(device.open_ports) & RTSP_PORTS)
    rtsp_results = await asyncio.gather(*(_probe_rtsp(device.ip, port) for port in rtsp_ports))
    for result in rtsp_results:
        if not result:
            continue
        probed = True
        raw.setdefault("probes", []).append(result)
        services.append(
            DiscoveredService(
                type="rtsp",
                port=result["port"],
                properties={"server": result.get("server"), "public": result.get("public")},
            )
        )

    banner_results = await asyncio.gather(*(_probe_banner(device.ip, port) for port in _banner_ports(device, probe_mode)))
    for result in banner_results:
        if not result:
            continue
        probed = True
        raw.setdefault("probes", []).append(result)
        services.append(_service_from_banner(result))
        _merge_probe_identity(updates, result)

    if probed:
        updates["source"] = sorted(set(device.source + ["probe"]))
    if raw:
        updates["raw"] = raw
    if services:
        updates["services"] = _dedupe_services(services)

    return device.model_copy(update=updates)


def _with_reverse_dns(device: DiscoveredDevice) -> DiscoveredDevice:
    if not device.ip or device.hostname:
        return device
    hostname = _reverse_dns(device.ip)
    return device.model_copy(update={"hostname": hostname}) if hostname else device


def _reverse_dns(ip: str) -> str | None:
    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
    except (socket.herror, socket.gaierror, OSError):
        return None
    return hostname.rstrip(".")


async def _probe_http(ip: str, port: int) -> dict[str, Any] | None:
    scheme = "https" if port in HTTPS_PORTS else "http"
    request = f"GET / HTTP/1.1\r\nHost: {ip}\r\nUser-Agent: mini-has/1.0\r\nConnection: close\r\n\r\n".encode()

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port, ssl=_ssl_context() if scheme == "https" else None),
            timeout=1.2,
        )
        writer.write(request)
        await writer.drain()
        data = await asyncio.wait_for(reader.read(65536), timeout=1.8)
        writer.close()
        await writer.wait_closed()
    except Exception:
        return None

    head, _, body = data.partition(b"\r\n\r\n")
    headers = _parse_http_headers(head.decode(errors="ignore"))
    body_text = body[:32768].decode(errors="ignore")
    title = _html_title(body_text)
    realm = _auth_realm(headers.get("www-authenticate", ""))

    return {
        "type": "http",
        "scheme": scheme,
        "port": port,
        "status": headers.get(":status"),
        "server": headers.get("server"),
        "title": title,
        "realm": realm,
        "location": headers.get("location"),
        "model": _model_from_http(headers, body_text),
    }


async def _probe_rtsp(ip: str, port: int) -> dict[str, Any] | None:
    request = f"OPTIONS rtsp://{ip}:{port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: mini-has/1.0\r\n\r\n".encode()
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=1.0)
        writer.write(request)
        await writer.drain()
        data = await asyncio.wait_for(reader.read(4096), timeout=1.2)
        writer.close()
        await writer.wait_closed()
    except Exception:
        return None

    text = data.decode(errors="ignore")
    if "RTSP/" not in text:
        return None
    headers = _parse_header_lines(text.splitlines()[1:])
    return {"type": "rtsp", "port": port, "server": headers.get("server"), "public": headers.get("public")}


async def _probe_banner(ip: str, port: int) -> dict[str, Any] | None:
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=0.8)
    except Exception:
        return None

    try:
        data = await asyncio.wait_for(reader.read(256), timeout=0.8)
    except asyncio.TimeoutError:
        data = b""
    except Exception:
        return None

    try:
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass

    banner = data.decode(errors="ignore").strip()
    if not banner:
        return _synthetic_banner(port)
    return {"type": _service_type_for_port(port), "port": port, "banner": banner}


def _banner_ports(device: DiscoveredDevice, probe_mode: ProbeMode) -> list[int]:
    ports = set(device.open_ports) & {21, 22, 23, 1883, 6053, 8266, 8883}
    if probe_mode == ProbeMode.balanced:
        ports &= {22, 6053, 8266}
    return sorted(ports)


def _synthetic_banner(port: int) -> dict[str, Any] | None:
    if port == 6053:
        return {"type": "esphome", "port": port}
    if port == 8266:
        return {"type": "arduino-ota", "port": port}
    if port in {1883, 8883}:
        return {"type": "mqtt", "port": port}
    return None


def _service_type_for_port(port: int) -> str:
    return {
        21: "ftp",
        22: "ssh",
        23: "telnet",
        1883: "mqtt",
        6053: "esphome",
        8266: "arduino-ota",
        8883: "mqtts",
    }.get(port, f"tcp/{port}")


def _parse_http_headers(text: str) -> dict[str, str]:
    lines = text.splitlines()
    headers: dict[str, str] = {}
    if lines:
        parts = lines[0].split()
        if len(parts) >= 2:
            headers[":status"] = parts[1]
    headers.update(_parse_header_lines(lines[1:]))
    return headers


def _parse_header_lines(lines: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def _html_title(text: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = re.sub(r"\s+", " ", unescape(match.group(1))).strip()
    return title[:120] or None


def _auth_realm(header: str) -> str | None:
    match = re.search(r'realm="([^"]+)"', header, flags=re.IGNORECASE)
    return match.group(1) if match else None


def _model_from_http(headers: dict[str, str], body: str) -> str | None:
    server = headers.get("server", "")
    for pattern in [
        r"(GoAhead-Webs?/[^\s<]+)",
        r"(Boa/[^\s<]+)",
        r"(lighttpd/[^\s<]+)",
        r"(ESP(?:32|8266)?[^\s<]*)",
        r"(Home Assistant)",
        r"(RouterOS)",
    ]:
        match = re.search(pattern, f"{server}\n{body}", flags=re.IGNORECASE)
        if match:
            return match.group(1)[:80]
    return None


def _merge_probe_identity(updates: dict[str, Any], result: dict[str, Any]) -> None:
    if not updates.get("name"):
        updates["name"] = result.get("title") or result.get("realm")
    if not updates.get("model") and result.get("model"):
        updates["model"] = result["model"]


def _service_from_http(result: dict[str, Any]) -> DiscoveredService:
    return DiscoveredService(
        type=result["scheme"],
        port=result["port"],
        properties={
            key: value
            for key, value in {
                "status": result.get("status"),
                "server": result.get("server"),
                "title": result.get("title"),
                "realm": result.get("realm"),
                "location": result.get("location"),
                "model": result.get("model"),
            }.items()
            if value
        },
    )


def _service_from_banner(result: dict[str, Any]) -> DiscoveredService:
    return DiscoveredService(
        type=result["type"],
        port=result["port"],
        properties={"banner": result["banner"]} if result.get("banner") else {},
    )


def _dedupe_services(services: list[DiscoveredService]) -> list[DiscoveredService]:
    deduped: dict[tuple[str | None, int | None, str | None], DiscoveredService] = {}
    for service in services:
        deduped[(service.type, service.port, service.name)] = service
    return list(deduped.values())


def _ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context
