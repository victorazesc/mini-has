from __future__ import annotations

import random
import socket
import struct
import time
from typing import Any

DEFAULT_SERVICE_TYPES = [
    "_http._tcp.local.",
    "_hap._tcp.local.",
    "_matter._tcp.local.",
    "_esphomelib._tcp.local.",
    "_mqtt._tcp.local.",
    "_googlecast._tcp.local.",
    "_arduino._tcp.local.",
    "_printer._tcp.local.",
]


def discover_mdns(timeout: float = 3.0) -> list[dict[str, Any]]:
    devices: dict[str, dict[str, Any]] = {}
    services_by_name: dict[str, dict[str, Any]] = {}
    target_to_ips: dict[str, set[str]] = {}

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.settimeout(0.2)

    try:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        for service_type in DEFAULT_SERVICE_TYPES:
            sock.sendto(_build_ptr_query(service_type), ("224.0.0.251", 5353))

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                data, _ = sock.recvfrom(9000)
            except socket.timeout:
                continue

            for record in _parse_records(data):
                rtype = record["rtype"]
                name = record["name"]
                value = record["value"]

                if rtype == 12:
                    service_name = value
                    services_by_name.setdefault(service_name, {"name": service_name})
                    services_by_name[service_name]["type"] = _service_type_from_name(name)
                elif rtype == 33:
                    service = services_by_name.setdefault(name, {"name": name})
                    service["port"] = value.get("port")
                    service["hostname"] = value.get("target")
                elif rtype in {1, 28}:
                    target_to_ips.setdefault(name, set()).add(value)
                elif rtype == 16:
                    service = services_by_name.setdefault(name, {"name": name})
                    service["properties"] = value

        for service in services_by_name.values():
            hostname = service.get("hostname")
            ips = sorted(target_to_ips.get(hostname or "", set()))
            if not ips:
                continue

            for ip in ips:
                device = devices.setdefault(
                    ip,
                    {
                        "ip": ip,
                        "hostname": hostname,
                        "source": ["mdns"],
                        "services": [],
                        "raw": {"mdns": []},
                    },
                )
                device["services"].append(
                    {
                        "type": service.get("type"),
                        "port": service.get("port"),
                        "name": service.get("name"),
                        "properties": service.get("properties") or {},
                    }
                )
                name = _display_name_from_service(service.get("name"))
                if name and not device.get("name"):
                    device["name"] = name
                model = _model_from_properties(service.get("properties") or {})
                if model and not device.get("model"):
                    device["model"] = model
                device["raw"]["mdns"].append(service)
    finally:
        sock.close()

    return list(devices.values())


def _build_ptr_query(service_type: str) -> bytes:
    txid = random.randint(0, 65535)
    header = struct.pack("!HHHHHH", txid, 0, 1, 0, 0, 0)
    qname = b"".join(bytes([len(label)]) + label.encode() for label in service_type.rstrip(".").split("."))
    return header + qname + b"\x00" + struct.pack("!HH", 12, 0x8001)


def _parse_records(data: bytes) -> list[dict[str, Any]]:
    if len(data) < 12:
        return []

    _, _, qdcount, ancount, nscount, arcount = struct.unpack("!HHHHHH", data[:12])
    offset = 12

    for _ in range(qdcount):
        _, offset = _read_name(data, offset)
        offset += 4

    records = []
    for _ in range(ancount + nscount + arcount):
        try:
            name, offset = _read_name(data, offset)
            rtype, _, _, rdlength = struct.unpack("!HHIH", data[offset : offset + 10])
            offset += 10
            rdata_offset = offset
            rdata = data[offset : offset + rdlength]
            offset += rdlength

            value = _decode_rdata(data, rtype, rdata, rdata_offset)
            if value is not None:
                records.append({"name": name, "rtype": rtype, "value": value})
        except (IndexError, struct.error, UnicodeDecodeError):
            break

    return records


def _read_name(data: bytes, offset: int) -> tuple[str, int]:
    labels = []
    jumped = False
    original_offset = offset
    seen_offsets = set()

    while True:
        length = data[offset]

        if length == 0:
            offset += 1
            break

        if length & 0xC0 == 0xC0:
            pointer = ((length & 0x3F) << 8) | data[offset + 1]
            if pointer in seen_offsets:
                break
            seen_offsets.add(pointer)
            if not jumped:
                original_offset = offset + 2
            offset = pointer
            jumped = True
            continue

        offset += 1
        labels.append(data[offset : offset + length].decode(errors="ignore"))
        offset += length

    return ".".join(labels) + ".", original_offset if jumped else offset


def _decode_rdata(data: bytes, rtype: int, rdata: bytes, offset: int) -> Any:
    if rtype == 1 and len(rdata) == 4:
        return socket.inet_ntop(socket.AF_INET, rdata)
    if rtype == 28 and len(rdata) == 16:
        return socket.inet_ntop(socket.AF_INET6, rdata)
    if rtype == 12:
        return _read_name(data, offset)[0]
    if rtype == 33 and len(rdata) >= 6:
        _, _, port = struct.unpack("!HHH", rdata[:6])
        target = _read_name(data, offset + 6)[0]
        return {"port": port, "target": target}
    if rtype == 16:
        props: dict[str, str] = {}
        index = 0
        while index < len(rdata):
            length = rdata[index]
            index += 1
            item = rdata[index : index + length].decode(errors="ignore")
            index += length
            if "=" in item:
                key, value = item.split("=", 1)
                props[key] = value
        return props
    return None


def _service_type_from_name(name: str) -> str | None:
    for service_type in DEFAULT_SERVICE_TYPES:
        if name == service_type:
            return service_type
    parts = name.rstrip(".").split(".")
    if len(parts) >= 3 and parts[-1] == "local":
        return ".".join(parts[-3:]) + "."
    return None


def _display_name_from_service(name: str | None) -> str | None:
    if not name:
        return None
    return name.split("._", 1)[0].strip(".") or None


def _model_from_properties(properties: dict[str, str]) -> str | None:
    for key in ("model", "md", "board"):
        value = properties.get(key)
        if value:
            return value.strip('"')[:80]
    return None
