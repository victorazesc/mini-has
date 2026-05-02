from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from src.app.modules.integrations.schemas import (
    IntegrationStatus,
    IntegrationTestResult,
    IntegrationType,
    ProviderDefinition,
    ProviderDevice,
    ProviderEntity,
    ProviderField,
    StoredIntegration,
)

EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
TUYA_BOOLEAN_PRIORITY = ["switch_led", "switch_1", "switch", "switch_2", "switch_3", "switch_4", "switch_usb1", "switch_usb2"]
TUYA_REGIONS = [
    {"key": "eastern-america", "label": "Eastern America", "baseUrl": "https://openapi-ueaz.tuyaus.com"},
    {"key": "western-america", "label": "Western America", "baseUrl": "https://openapi.tuyaus.com"},
    {"key": "central-europe", "label": "Central Europe", "baseUrl": "https://openapi.tuyaeu.com"},
    {"key": "western-europe", "label": "Western Europe", "baseUrl": "https://openapi-weaz.tuyaeu.com"},
    {"key": "india", "label": "India", "baseUrl": "https://openapi.tuyain.com"},
    {"key": "china", "label": "China", "baseUrl": "https://openapi.tuyacn.com"},
]
SECRET_FIELDS = {
    IntegrationType.tuya_cloud: {"accessSecret"},
    IntegrationType.smartthings_cloud: {"token"},
    IntegrationType.tuya_local: {"localKey"},
}


def list_provider_definitions() -> list[ProviderDefinition]:
    return [
        ProviderDefinition(
            type=IntegrationType.tuya_cloud,
            name="Tuya Cloud",
            description="Importa devices da conta Tuya/Smart Life e localKey quando a API disponibilizar.",
            fields=[
                ProviderField(key="accessId", label="Access ID", required=True),
                ProviderField(key="accessSecret", label="Access Secret", required=True, secret=True),
                ProviderField(key="region", label="Regiao", default="auto", help="auto, eastern-america, western-america, central-europe, western-europe, india, china"),
            ],
        ),
        ProviderDefinition(
            type=IntegrationType.smartthings_cloud,
            name="SmartThings",
            description="Importa devices e capabilities pela API cloud da SmartThings.",
            fields=[ProviderField(key="token", label="Personal Access Token", required=True, secret=True)],
        ),
        ProviderDefinition(
            type=IntegrationType.intelbras_izy_tuya,
            name="Intelbras Izy",
            description="Provider para devices Izy compatíveis com Tuya LAN/Cloud.",
            fields=[ProviderField(key="mode", label="Modo", default="tuya_compatible")],
        ),
        ProviderDefinition(
            type=IntegrationType.persiana_custom,
            name="Persiana Custom",
            description="Provider local para a persiana fabricada em casa.",
            fields=[
                ProviderField(key="baseUrl", label="Base URL", required=True),
                ProviderField(key="roomHint", label="Comodo sugerido"),
            ],
        ),
        ProviderDefinition(
            type=IntegrationType.generic_iot,
            name="Generic IoT",
            description="Cadastro de device HTTP/local simples quando ainda nao existe provider dedicado.",
            fields=[
                ProviderField(key="baseUrl", label="Base URL"),
                ProviderField(key="ip", label="IP"),
                ProviderField(key="deviceType", label="Tipo", default="iot"),
            ],
        ),
        ProviderDefinition(type=IntegrationType.esphome, name="ESPHome", description="Provider reservado para ESPHome local.", status="planned"),
        ProviderDefinition(type=IntegrationType.onvif_camera, name="ONVIF Camera", description="Provider reservado para cameras ONVIF/RTSP.", status="planned"),
        ProviderDefinition(type=IntegrationType.mqtt, name="MQTT", description="Provider reservado para entidades via broker MQTT.", status="planned"),
    ]


def split_provider_config(provider_type: IntegrationType, config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    secrets = {}
    public_config = {}
    for key, value in config.items():
        if key in SECRET_FIELDS.get(provider_type, set()):
            secrets[key] = value
        else:
            public_config[key] = value
    return public_config, secrets


def test_provider(integration: StoredIntegration) -> IntegrationTestResult:
    try:
        if integration.type == IntegrationType.tuya_cloud:
            token, region = _tuya_get_token_for_integration(integration)
            return IntegrationTestResult(ok=bool(token), status=IntegrationStatus.connected, message=f"Tuya conectada em {region['label']}.")
        if integration.type == IntegrationType.smartthings_cloud:
            devices = _smartthings_request(integration, "/v1/devices")
            return IntegrationTestResult(ok=True, status=IntegrationStatus.connected, message="SmartThings conectado.", details={"count": len(devices.get("items", []))})
        if integration.type in {IntegrationType.persiana_custom, IntegrationType.generic_iot}:
            return _test_http_like_provider(integration)
        if integration.type == IntegrationType.intelbras_izy_tuya:
            return IntegrationTestResult(ok=True, status=IntegrationStatus.connected, message="Izy configurado como Tuya-compatible.")
        return IntegrationTestResult(ok=True, status=IntegrationStatus.created, message="Provider registrado; sync ainda nao implementado.")
    except Exception as exc:
        return IntegrationTestResult(ok=False, status=IntegrationStatus.error, message=str(exc))


def sync_provider(integration: StoredIntegration) -> tuple[list[ProviderDevice], dict[str, Any]]:
    if integration.type == IntegrationType.tuya_cloud:
        return _sync_tuya_cloud(integration)
    if integration.type == IntegrationType.smartthings_cloud:
        return _sync_smartthings(integration)
    if integration.type in {IntegrationType.persiana_custom, IntegrationType.generic_iot}:
        return [_device_from_http_like_provider(integration)], {}
    if integration.type == IntegrationType.intelbras_izy_tuya:
        return [], {"note": "Use discovery LAN para achar Tuya 6667/6668 e Tuya Cloud para obter nomes/localKey."}
    return [], {"note": "Provider planejado."}


def send_tuya_device_commands(integration: StoredIntegration, device_id: str, commands: list[dict[str, Any]]) -> dict[str, Any]:
    token, region = _tuya_get_token_for_integration(integration)
    response = _tuya_request(
        integration,
        region,
        "POST",
        f"/v1.0/iot-03/devices/{device_id}/commands",
        body={"commands": commands},
        access_token=token,
    )
    if not response.get("success"):
        raise RuntimeError(response.get("msg") or "Falha ao enviar comando Tuya.")
    return {"region": region["key"], "response": response}


def _sync_tuya_cloud(integration: StoredIntegration) -> tuple[list[ProviderDevice], dict[str, Any]]:
    token, region = _tuya_get_token_for_integration(integration)
    devices: list[dict[str, Any]] = []
    has_more = True
    last_row_key = ""
    total = 0

    while has_more:
        response = _tuya_request(
            integration,
            region,
            "GET",
            "/v1.0/iot-01/associated-users/devices",
            {"last_row_key": last_row_key, "size": "100"},
            access_token=token,
        )
        if not response.get("success"):
            raise RuntimeError(response.get("msg") or "Falha ao listar devices Tuya.")

        result = response.get("result") or {}
        devices.extend(result.get("devices") or [])
        has_more = bool(result.get("has_more"))
        last_row_key = result.get("last_row_key") or ""
        total = result.get("total") or len(devices)
        if has_more and not last_row_key:
            break

    return [_normalize_tuya_device(device, region) for device in devices], {"region": region["key"], "total": total}


def _tuya_get_token_for_integration(integration: StoredIntegration) -> tuple[str, dict[str, str]]:
    regions = _tuya_regions_for(integration.config.get("region") or integration.config.get("regionKey") or "auto")
    last_error = "Tuya recusou a autenticacao."
    for region in regions:
        response = _tuya_request(integration, region, "GET", "/v1.0/token", {"grant_type": "1"})
        if response.get("success") and response.get("result", {}).get("access_token"):
            return response["result"]["access_token"], region
        last_error = response.get("msg") or last_error
    raise RuntimeError(last_error)


def _tuya_request(
    integration: StoredIntegration,
    region: dict[str, str],
    method: str,
    path: str,
    query: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    access_id = str(integration.config.get("accessId") or "").strip()
    access_secret = str(integration.secrets.get("accessSecret") or "").strip()
    if not access_id or not access_secret:
        raise ValueError("Access ID e Access Secret da Tuya sao obrigatorios.")

    query = {key: str(value) for key, value in (query or {}).items() if str(value) != ""}
    query_string = urlencode(sorted(query.items()))
    canonical_path = f"{path}?{query_string}" if query_string else path
    body_string = json.dumps(body, separators=(",", ":")) if body else ""
    body_hash = hashlib.sha256(body_string.encode()).hexdigest() if body_string else EMPTY_BODY_SHA256
    string_to_sign = "\n".join([method, body_hash, "", canonical_path])
    timestamp = str(int(time.time() * 1000))
    nonce = uuid.uuid4().hex
    signing_payload = f"{access_id}{access_token or ''}{timestamp}{nonce}{string_to_sign}"
    sign = hmac.new(access_secret.encode(), signing_payload.encode(), hashlib.sha256).hexdigest().upper()
    url = f"{region['baseUrl']}{canonical_path}"
    headers = {
        "client_id": access_id,
        "nonce": nonce,
        "sign": sign,
        "sign_method": "HMAC-SHA256",
        "t": timestamp,
    }
    if access_token:
        headers["access_token"] = access_token
    if body_string:
        headers["Content-Type"] = "application/json"

    return _http_json(method, url, headers=headers, body=body_string or None)


def _normalize_tuya_device(device: dict[str, Any], region: dict[str, str]) -> ProviderDevice:
    status = device.get("status") or []
    switch_code = _primary_switch_code(status)
    kind = _infer_tuya_kind(device, switch_code)
    local_key = (device.get("local_key") or "").strip() or None
    ip = (device.get("last_ip") or device.get("ip") or "").strip() or None
    external_id = str(device.get("id") or device.get("dev_id") or "").strip()
    name = (device.get("name") or device.get("product_name") or "Dispositivo Tuya").strip()
    entity_type = "light" if kind == "light" else "switch" if kind == "switch" else "sensor" if kind == "sensor" else kind
    entities = []
    if switch_code:
        entities.append(
            ProviderEntity(
                key=switch_code,
                type=entity_type,
                name=name,
                commandSchema={"commands": ["turn_on", "turn_off", "toggle"], "switchCode": switch_code},
                state={"online": device.get("online"), "status": status},
                capabilities={"status": status},
            )
        )

    return ProviderDevice(
        externalId=external_id,
        name=name,
        provider="tuya_cloud",
        deviceType=kind,
        manufacturer="Tuya",
        model=(device.get("model") or "").strip() or None,
        ip=ip,
        productKey=(device.get("product_key") or device.get("productKey") or "").strip() or None,
        localDeviceKey=f"tuya:{external_id}",
        capabilities={"category": device.get("category"), "primarySwitchCode": switch_code, "status": status},
        status={"online": device.get("online"), "state": _infer_tuya_state(status, device.get("online"), switch_code, kind)},
        payload={
            "category": device.get("category"),
            "productName": device.get("product_name"),
            "regionKey": region["key"],
            "regionLabel": region["label"],
            "raw": {key: value for key, value in device.items() if key != "local_key"},
        },
        secrets={"localKey": local_key} if local_key else {},
        entities=entities,
    )


def _sync_smartthings(integration: StoredIntegration) -> tuple[list[ProviderDevice], dict[str, Any]]:
    response = _smartthings_request(integration, "/v1/devices")
    devices = response.get("items") or []
    return [_normalize_smartthings_device(device) for device in devices], {"total": len(devices)}


def _smartthings_request(integration: StoredIntegration, path: str) -> dict[str, Any]:
    token = str(integration.secrets.get("token") or "").strip()
    if not token:
        raise ValueError("Token SmartThings obrigatorio.")
    return _http_json("GET", f"https://api.smartthings.com{path}", headers={"Authorization": f"Bearer {token}"})


def _normalize_smartthings_device(device: dict[str, Any]) -> ProviderDevice:
    external_id = str(device.get("deviceId") or "").strip()
    label = device.get("label") or device.get("name") or "Dispositivo SmartThings"
    components = device.get("components") or []
    capabilities = [capability.get("id") for component in components for capability in component.get("capabilities", [])]
    kind = "sensor"
    if "switch" in capabilities:
        kind = "switch"
    elif "switchLevel" in capabilities or "colorControl" in capabilities:
        kind = "light"
    elif "thermostat" in capabilities or "airConditionerMode" in capabilities:
        kind = "climate"

    entities = [
        ProviderEntity(
            key="main",
            type=kind,
            name=label,
            commandSchema={"capabilities": capabilities},
            capabilities={"components": components},
        )
    ]
    return ProviderDevice(
        externalId=external_id,
        name=label,
        provider="smartthings_cloud",
        deviceType=kind,
        manufacturer=device.get("manufacturerName"),
        model=device.get("deviceManufacturerCode") or device.get("mnmn"),
        capabilities={"capabilities": capabilities, "components": components},
        payload={"raw": device},
        entities=entities,
    )


def _test_http_like_provider(integration: StoredIntegration) -> IntegrationTestResult:
    base_url = str(integration.config.get("baseUrl") or "").rstrip("/")
    if not base_url:
        return IntegrationTestResult(ok=False, status=IntegrationStatus.error, message="baseUrl obrigatoria.")
    try:
        _http_json("GET", f"{base_url}/health")
        return IntegrationTestResult(ok=True, status=IntegrationStatus.connected, message="Endpoint respondeu /health.")
    except Exception:
        return IntegrationTestResult(ok=True, status=IntegrationStatus.connected, message="Provider salvo; /health nao respondeu, mas pode usar comandos configurados.")


def _device_from_http_like_provider(integration: StoredIntegration) -> ProviderDevice:
    base_url = str(integration.config.get("baseUrl") or "").rstrip("/")
    name = integration.name
    device_type = str(integration.config.get("deviceType") or ("cover" if integration.type == IntegrationType.persiana_custom else "iot"))
    command_schema = {"commands": ["open", "close", "stop", "set_position"]} if device_type == "cover" else {"commands": ["custom"]}
    return ProviderDevice(
        externalId=base_url or f"integration:{integration.id}",
        name=name,
        provider=integration.type.value,
        deviceType=device_type,
        ip=integration.config.get("ip"),
        localDeviceKey=f"http:{base_url}" if base_url else None,
        capabilities={"baseUrl": base_url},
        payload={"baseUrl": base_url},
        entities=[
            ProviderEntity(
                key="main",
                type=device_type,
                name=name,
                commandSchema=command_schema,
                capabilities={"baseUrl": base_url},
            )
        ],
    )


def _http_json(method: str, url: str, headers: dict[str, str] | None = None, body: str | None = None) -> dict[str, Any]:
    request = Request(url, data=body.encode() if body else None, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            data = response.read()
    except HTTPError as exc:
        data = exc.read()
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc
    if not data:
        return {}
    try:
        return json.loads(data.decode())
    except json.JSONDecodeError:
        return {"raw": data.decode(errors="ignore")}


def _tuya_regions_for(region_key: str) -> list[dict[str, str]]:
    if region_key == "auto":
        return TUYA_REGIONS
    return [region for region in TUYA_REGIONS if region["key"] == region_key] or TUYA_REGIONS


def _primary_switch_code(status: list[dict[str, Any]]) -> str | None:
    for code in TUYA_BOOLEAN_PRIORITY:
        if any(entry.get("code") == code and isinstance(entry.get("value"), bool) for entry in status):
            return code
    for entry in status:
        code = str(entry.get("code") or "")
        if code.startswith("switch") and isinstance(entry.get("value"), bool):
            return code
    for entry in status:
        if isinstance(entry.get("value"), bool):
            return str(entry.get("code"))
    return None


def _infer_tuya_kind(device: dict[str, Any], switch_code: str | None) -> str:
    text = " ".join(str(device.get(key) or "") for key in ["category", "product_name", "model", "name"]).lower()
    codes = {str(entry.get("code") or "").lower() for entry in device.get("status") or []}
    if any(term in text for term in ["camera", "cam", "ipc"]):
        return "camera"
    if any(term in text for term in ["curtain", "cover", "persiana", "cortina"]):
        return "cover"
    if any(term in text for term in ["alarm", "siren", "alarme"]):
        return "alarm"
    if codes & {"bright", "bright_value", "bright_value_v2", "colour_data", "colour_data_v2", "temp_value", "temp_value_v2", "work_mode"}:
        return "light"
    if codes & {"va_battery", "battery_state", "battery_percentage", "doorcontact_state", "pir", "smoke_sensor_state", "temp_current", "humidity_value"}:
        return "sensor"
    if switch_code:
        return "light" if any(term in text for term in ["lamp", "luz", "ews410"]) else "switch"
    return "iot"


def _infer_tuya_state(status: list[dict[str, Any]], online: bool | None, switch_code: str | None, kind: str) -> str:
    if switch_code:
        for entry in status:
            if entry.get("code") == switch_code and isinstance(entry.get("value"), bool):
                return "on" if entry["value"] else "off"
    if online is False:
        return "off"
    return "idle" if kind in {"sensor", "alarm"} else "unknown"
