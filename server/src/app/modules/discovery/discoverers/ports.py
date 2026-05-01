from __future__ import annotations

import asyncio

DEFAULT_PORTS = [
    21,
    22,
    23,
    53,
    80,
    81,
    443,
    554,
    1883,
    5000,
    5353,
    6053,
    8000,
    8008,
    8009,
    8080,
    8123,
    8266,
    8554,
    8883,
    9000,
]


async def scan_open_ports(ips: list[str], ports: list[int] | None = None, timeout: float = 0.4) -> dict[str, list[int]]:
    ports = ports or DEFAULT_PORTS
    semaphore = asyncio.Semaphore(256)
    result: dict[str, list[int]] = {ip: [] for ip in ips}

    async def probe(ip: str, port: int) -> None:
        async with semaphore:
            try:
                _, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=timeout)
                writer.close()
                await writer.wait_closed()
                result[ip].append(port)
            except Exception:
                return

    await asyncio.gather(*(probe(ip, port) for ip in ips for port in ports))
    return {ip: sorted(open_ports) for ip, open_ports in result.items() if open_ports}
