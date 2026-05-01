from __future__ import annotations

import csv
import os
import time
from pathlib import Path
from urllib.request import urlopen

OUI_URL = "https://standards-oui.ieee.org/oui/oui.csv"
CACHE_PATH = Path(os.getenv("MINI_HAS_OUI_CACHE", ".cache/mini-has/oui.csv"))
CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

FALLBACK_MANUFACTURERS = {
    "08:3A:F2": "Espressif",
    "24:0A:C4": "Espressif",
    "30:AE:A4": "Espressif",
    "3C:61:05": "Espressif",
    "7C:DF:A1": "Espressif",
    "84:F3:EB": "Espressif",
    "A0:20:A6": "Espressif",
    "AC:67:B2": "Espressif",
    "B4:E6:2D": "Espressif",
    "C4:5B:BE": "Espressif",
    "CC:50:E3": "Espressif",
    "D8:BF:C0": "Espressif",
    "DC:4F:22": "Espressif",
    "E0:5A:1B": "Espressif",
    "EC:94:CB": "Espressif",
    "FC:F5:C4": "Espressif",
    "60:01:94": "Espressif",
    "40:91:51": "Espressif",
    "48:3F:DA": "Espressif",
    "2C:F4:32": "Espressif",
    "E8:DB:84": "Espressif",
    "44:17:93": "Espressif",
    "98:F4:AB": "Espressif",
    "8C:AA:B5": "Espressif",
    "34:85:18": "Espressif",
    "D8:1F:12": "Espressif",
    "CC:7B:5C": "Espressif",
    "B8:06:0D": "Espressif",
    "90:23:5B": "Espressif",
    "48:78:5E": "Espressif",
    "C8:98:28": "TP-Link",
    "B4:1F:4D": "TP-Link",
    "C4:EB:FF": "TP-Link",
    "0C:8E:29": "Tuya",
    "4C:A9:19": "Samsung",
}

_cache: dict[str, str] | None = None


def lookup_manufacturer(mac: str | None) -> str | None:
    prefix = _mac_prefix(mac)
    if not prefix:
        return None
    return _manufacturers().get(prefix)


def _manufacturers() -> dict[str, str]:
    global _cache
    if _cache is None:
        _cache = {**FALLBACK_MANUFACTURERS, **_load_cache()}
    return _cache


def _load_cache() -> dict[str, str]:
    if _cache_is_stale(CACHE_PATH):
        _refresh_cache(CACHE_PATH)
    if not CACHE_PATH.exists():
        return {}

    try:
        with CACHE_PATH.open(encoding="utf-8", newline="") as file:
            rows = csv.DictReader(file)
            return {
                _format_assignment(row.get("Assignment")): (row.get("Organization Name") or "").strip()
                for row in rows
                if _format_assignment(row.get("Assignment")) and row.get("Organization Name")
            }
    except OSError:
        return {}


def _refresh_cache(path: Path) -> None:
    try:
        with urlopen(OUI_URL, timeout=5) as response:
            data = response.read(8_000_000)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        return


def _cache_is_stale(path: Path) -> bool:
    try:
        return time.time() - path.stat().st_mtime > CACHE_MAX_AGE_SECONDS
    except OSError:
        return True


def _mac_prefix(mac: str | None) -> str | None:
    if not mac:
        return None
    parts = mac.upper().replace("-", ":").split(":")
    if len(parts) < 3:
        return None
    return ":".join(part.zfill(2) for part in parts[:3])


def _format_assignment(value: str | None) -> str:
    value = (value or "").strip().upper().replace("-", "").replace(":", "")
    if len(value) < 6:
        return ""
    return ":".join(value[index : index + 2] for index in range(0, 6, 2))
