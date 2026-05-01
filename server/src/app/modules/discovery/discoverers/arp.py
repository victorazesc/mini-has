from __future__ import annotations

import asyncio
import ipaddress
import platform
import re
import subprocess
from typing import Any


async def discover_arp(subnet_prefix: str, timeout: float = 1.0) -> list[dict[str, Any]]:
    await _ping_sweep(subnet_prefix, timeout)
    return _filter_subnet(_read_arp_table(), subnet_prefix)


async def _ping_sweep(subnet_prefix: str, timeout: float) -> None:
    ips = _subnet_ips(subnet_prefix)
    semaphore = asyncio.Semaphore(64)

    async def ping(ip: str) -> None:
        async with semaphore:
            system = platform.system().lower()
            if system == "darwin":
                cmd = ["ping", "-c", "1", "-W", str(int(timeout * 1000)), ip]
            else:
                cmd = ["ping", "-c", "1", "-W", str(max(1, int(timeout))), ip]

            try:
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(process.communicate(), timeout=timeout + 0.5)
            except Exception:
                return

    await asyncio.gather(*(ping(ip) for ip in ips))


def _subnet_ips(subnet_prefix: str) -> list[str]:
    if "/" in subnet_prefix:
        network = ipaddress.ip_network(subnet_prefix, strict=False)
        return [str(ip) for ip in network.hosts()]
    return [f"{subnet_prefix}.{index}" for index in range(1, 255)]


def _filter_subnet(devices: list[dict[str, Any]], subnet_prefix: str) -> list[dict[str, Any]]:
    if "/" in subnet_prefix:
        network = ipaddress.ip_network(subnet_prefix, strict=False)
        return [device for device in devices if device.get("ip") and ipaddress.ip_address(device["ip"]) in network]
    prefix = subnet_prefix.rstrip(".") + "."
    return [device for device in devices if str(device.get("ip", "")).startswith(prefix)]


def _read_arp_table() -> list[dict[str, Any]]:
    linux = _read_linux_arp()
    if linux:
        return linux
    return _read_command_arp()


def _read_linux_arp() -> list[dict[str, Any]]:
    try:
        with open("/proc/net/arp", encoding="utf-8") as file:
            lines = file.readlines()[1:]
    except FileNotFoundError:
        return []

    devices = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 4 and _is_mac(parts[3]):
            devices.append({"ip": parts[0], "mac": parts[3].upper(), "source": ["arp"]})
    return devices


def _read_command_arp() -> list[dict[str, Any]]:
    try:
        output = subprocess.check_output(["arp", "-an"], stderr=subprocess.DEVNULL, text=True)
    except (FileNotFoundError, subprocess.SubprocessError):
        return []

    devices = []
    for line in output.splitlines():
        ip_match = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", line) or re.search(r"^(\d+\.\d+\.\d+\.\d+)\s", line)
        mac_match = re.search(r"([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})", line)
        if ip_match and mac_match:
            mac = ":".join(part.zfill(2) for part in mac_match.group(1).split(":")).upper()
            devices.append({"ip": ip_match.group(1), "mac": mac, "source": ["arp"]})
    return devices

def _is_mac(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}", value))
