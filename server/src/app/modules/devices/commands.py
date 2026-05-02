from __future__ import annotations

import json
from typing import Any
from urllib.parse import urljoin

from src.app.modules.devices.schema import Device
from src.app.modules.devices.tuya_lan import DEFAULT_PORT, DEFAULT_TIMEOUT_MS, TuyaLanClient
from src.app.modules.entities.schemas import CommandRequest, CommandResult
from src.app.modules.integrations.providers import _http_json, send_tuya_device_commands
from src.app.modules.integrations.store import get_integration


def execute_device_command(device: Device, secrets: dict[str, Any], request: CommandRequest) -> CommandResult:
    try:
        if device.provider in {"tuya_cloud", "tuya_local", "intelbras_izy_tuya"}:
            return _execute_tuya_command(device, secrets, request)
        if device.provider in {"generic_iot", "persiana_custom"}:
            return _execute_http_command(device, request)
        return CommandResult(ok=False, status="unsupported", message=f"Provider {device.provider} ainda nao tem executor.", result={})
    except Exception as exc:
        return CommandResult(ok=False, status="error", message=str(exc), result={"deviceId": device.id, "command": request.command})


def _execute_tuya_command(device: Device, secrets: dict[str, Any], request: CommandRequest) -> CommandResult:
    transport = str(request.params.get("transport") or "local").strip()
    if transport == "cloud":
        return _execute_tuya_cloud_command(device, request)

    try:
        return _execute_tuya_local_command(device, secrets, request)
    except Exception as local_error:
        if not device.integration_id:
            raise

        cloud_result = _execute_tuya_cloud_command(device, request)
        cloud_result.message = "Comando enviado pela Tuya Cloud apos falha na conexao local."
        cloud_result.result = {
            **cloud_result.result,
            "fallbackFrom": "local",
            "localError": str(local_error),
        }
        return cloud_result


def _execute_tuya_cloud_command(device: Device, request: CommandRequest) -> CommandResult:
    if not device.integration_id:
        raise ValueError("Device Tuya sem integrationId.")
    integration = get_integration(device.integration_id)
    if not integration:
        raise ValueError("Integracao Tuya nao encontrada.")
    commands = _tuya_commands_from_request(device, request)
    result = send_tuya_device_commands(integration, device.external_id, commands)
    return CommandResult(
        ok=True,
        status="sent",
        message="Comando enviado para Tuya.",
        result={"deviceId": device.id, "provider": device.provider, "commands": commands, "dps": _dps_from_tuya_commands(commands), **result},
    )


def _execute_tuya_local_command(device: Device, secrets: dict[str, Any], request: CommandRequest) -> CommandResult:
    config = _tuya_local_config(device, secrets, request)
    dps_id = _tuya_local_dps_id(device, request)
    with TuyaLanClient(config["ip"], config["deviceId"], config["localKey"], config["port"], config["timeoutMs"]) as client:
        if request.command == "query":
            payload = client.query_status(config.get("cid"))
            return _tuya_local_result(device, config, "query", dps_id, None, payload)

        value = _tuya_local_value(device, request, dps_id, client, config.get("cid"))
        if request.params.get("waitForStatus") is not False:
            payload = client.set_dps_value(dps_id, value, config.get("cid"))
        else:
            payload = client.set_dps_value_nowait(dps_id, value, config.get("cid"))
        return _tuya_local_result(device, config, "command", dps_id, value, payload)


def _tuya_local_result(device: Device, config: dict[str, Any], action: str, dps_id: str, value: Any, payload: dict[str, Any]) -> CommandResult:
    return CommandResult(
        ok=True,
        status="sent" if action == "command" else "ok",
        message="Comando enviado pela rede local." if action == "command" else "Status local consultado.",
        result={
            "deviceId": device.id,
            "provider": device.provider,
            "transport": "local",
            "ip": config["ip"],
            "port": config["port"],
            "dpsId": dps_id,
            "value": value,
            "dps": payload.get("dps") if isinstance(payload, dict) else None,
        },
    )


def _tuya_local_config(device: Device, secrets: dict[str, Any], request: CommandRequest) -> dict[str, Any]:
    ip = _first_non_empty(
        request.params.get("ip"),
        _nested(device.payload, "local", "ip"),
        device.payload.get("ip"),
        _nested(device.payload, "payload", "ip"),
        _nested(device.payload, "payload", "raw", "last_ip"),
        _nested(device.payload, "payload", "raw", "ip"),
        (device.local_device_key or "").removeprefix("ip:") if (device.local_device_key or "").startswith("ip:") else None,
    )
    local_key = _first_non_empty(request.params.get("localKey"), secrets.get("localKey"), _nested(device.payload, "local", "localKey"))
    device_id = _first_non_empty(request.params.get("deviceId"), device.payload.get("externalId"), _nested(device.payload, "local", "deviceId"), device.external_id)
    if not ip:
        raise ValueError("Device sem IP local. Vincule com discovery ou informe params.ip.")
    if not local_key:
        raise ValueError("Device sem localKey. Sincronize pela Tuya Cloud ou cadastre a chave local.")
    return {
        "ip": ip,
        "deviceId": device_id,
        "localKey": local_key,
        "cid": _first_non_empty(request.params.get("cid"), _nested(device.payload, "local", "cid"), device.payload.get("cid")),
        "port": int(request.params.get("port") or _nested(device.payload, "local", "port") or device.payload.get("port") or DEFAULT_PORT),
        "timeoutMs": int(request.params.get("timeoutMs") or DEFAULT_TIMEOUT_MS),
    }


def _tuya_local_dps_id(device: Device, request: CommandRequest) -> str:
    raw_commands = request.params.get("commands")
    first_command = raw_commands[0] if isinstance(raw_commands, list) and raw_commands and isinstance(raw_commands[0], dict) else {}
    raw_code = _first_non_empty(
        request.params.get("dpsId"),
        request.params.get("dpId"),
        request.params.get("primaryDpsId"),
        first_command.get("dpsId"),
        first_command.get("dpId"),
        first_command.get("code"),
        _nested(device.payload, "local", "primaryDpsId"),
        device.payload.get("primaryDpsId"),
        device.capabilities.get("primaryDpsId"),
        device.capabilities.get("primarySwitchCode"),
    )
    if not raw_code:
        return "1"
    code = str(raw_code)
    if code.isdigit():
        return code
    if code.startswith("switch_") and code.removeprefix("switch_").isdigit():
        return code.removeprefix("switch_")
    if code in {"switch", "switch_led"}:
        return "1"
    return code


def _tuya_local_value(device: Device, request: CommandRequest, dps_id: str, client: TuyaLanClient, cid: str | None) -> Any:
    raw_commands = request.params.get("commands")
    if isinstance(raw_commands, list) and raw_commands and isinstance(raw_commands[0], dict) and "value" in raw_commands[0]:
        return raw_commands[0]["value"]
    if request.command == "turn_on":
        return True
    if request.command == "turn_off":
        return False
    if request.command == "toggle":
        payload = client.query_status(cid)
        current = (payload.get("dps") or {}).get(dps_id)
        if not isinstance(current, bool):
            raise ValueError("Nao consegui inferir o estado atual para toggle local.")
        return not current
    if request.command == "set":
        if "value" not in request.params:
            raise ValueError("Parametro value obrigatorio para set.")
        return request.params["value"]
    if request.command in {"open", "close", "stop"}:
        return request.command
    if request.command == "set_position":
        if "position" not in request.params:
            raise ValueError("Parametro position obrigatorio para set_position.")
        return request.params["position"]
    if "value" in request.params:
        return request.params["value"]
    raise ValueError("Comando local invalido. Envie turn_on/turn_off/toggle, set ou params.commands.")


def _tuya_commands_from_request(device: Device, request: CommandRequest) -> list[dict[str, Any]]:
    raw_commands = request.params.get("commands")
    if isinstance(raw_commands, list) and raw_commands:
        return raw_commands

    code = str(request.params.get("code") or request.params.get("switchCode") or "").strip()
    if not code:
        dps_id = request.params.get("dpsId") or request.params.get("dpId")
        if dps_id is not None:
            dps_code = str(dps_id).strip()
            code = f"switch_{dps_code}" if dps_code.isdigit() else dps_code
    if not code:
        code = str(device.capabilities.get("primarySwitchCode") or "").strip()

    if request.command == "turn_on":
        return [{"code": _required_code(code), "value": True}]
    if request.command == "turn_off":
        return [{"code": _required_code(code), "value": False}]
    if request.command == "toggle":
        return [{"code": _required_code(code), "value": not _current_bool_value(device, code)}]
    if request.command == "set":
        return [{"code": _required_code(code), "value": request.params.get("value")}]
    if request.command in {"open", "close", "stop"}:
        return [{"code": request.params.get("code") or "control", "value": request.command}]
    if request.command == "set_position":
        if "position" not in request.params:
            raise ValueError("Parametro position obrigatorio para set_position.")
        return [{"code": request.params.get("code") or "percent_control", "value": request.params.get("position")}]

    if code and "value" in request.params:
        return [{"code": code, "value": request.params["value"]}]
    raise ValueError("Comando Tuya invalido. Envie turn_on/turn_off/toggle ou params.commands.")


def _dps_from_tuya_commands(commands: list[dict[str, Any]]) -> dict[str, Any]:
    dps: dict[str, Any] = {}
    for command in commands:
        code = str(command.get("code") or "")
        if not code or "value" not in command:
            continue
        dps[_dps_id_from_code(code)] = command["value"]
    return dps


def _required_code(code: str) -> str:
    if not code:
        raise ValueError("Codigo DP Tuya nao encontrado para este device.")
    return code


def _current_bool_value(device: Device, code: str) -> bool:
    for entry in device.capabilities.get("status") or []:
        if entry.get("code") == code and isinstance(entry.get("value"), bool):
            return entry["value"]
    raise ValueError("Nao consegui inferir o estado atual para toggle.")


def _execute_http_command(device: Device, request: CommandRequest) -> CommandResult:
    base_url = _http_base_url(device)
    if not base_url:
        raise ValueError("Device sem baseUrl para comando HTTP.")
    method = str(request.params.get("method") or "POST").upper()
    path = str(request.params.get("path") or f"/{request.command}")
    body = request.params.get("body") or {"command": request.command, "params": request.params}
    response = _http_json(method, urljoin(f"{base_url.rstrip('/')}/", path.lstrip("/")), headers={"Content-Type": "application/json"}, body=json.dumps(body, separators=(",", ":")))
    return CommandResult(ok=True, status="sent", message="Comando enviado por HTTP.", result={"deviceId": device.id, "provider": device.provider, "response": response})


def _http_base_url(device: Device) -> str:
    base_url = str(device.payload.get("baseUrl") or device.capabilities.get("baseUrl") or "").strip()
    if base_url:
        return base_url
    local_key = device.local_device_key or ""
    return local_key.removeprefix("http:") if local_key.startswith("http:") else ""


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
