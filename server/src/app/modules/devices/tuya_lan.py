from __future__ import annotations

import hashlib
import hmac
import json
import socket
import struct
import subprocess
import time
from dataclasses import dataclass
from typing import Any


DEFAULT_PORT = 6668
DEFAULT_TIMEOUT_MS = 3500
CMD_SESS_KEY_NEG_START = 3
CMD_SESS_KEY_NEG_RESP = 4
CMD_SESS_KEY_NEG_FINISH = 5
CMD_CONTROL_NEW = 0x0D
CMD_DP_QUERY_NEW = 0x10
PREFIX_55AA = 0x000055AA
SUFFIX_55AA = 0x0000AA55
HEADER_SIZE = 16
RETCODE_SIZE = 4
HMAC_SIZE = 32
SUFFIX_SIZE = 4
VERSION_34_HEADER = b"3.4" + (b"\x00" * 13)
LOCAL_NONCE = b"0123456789abcdef"


@dataclass(frozen=True)
class ParsedMessage:
    sequence: int
    command: int
    retcode: int
    payload: bytes


class TuyaLanClient:
    def __init__(self, ip: str, device_id: str, local_key: str, port: int = DEFAULT_PORT, timeout_ms: int = DEFAULT_TIMEOUT_MS) -> None:
        if len(local_key) != 16:
            raise ValueError("A local key precisa ter 16 caracteres.")
        self.ip = ip
        self.device_id = device_id
        self.real_local_key = local_key.encode()
        self.port = port
        self.timeout = timeout_ms / 1000
        self.current_key = self.real_local_key
        self.sequence_number = 1
        self.socket: socket.socket | None = None

    def __enter__(self) -> "TuyaLanClient":
        self.connect()
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def connect(self) -> None:
        self.socket = socket.create_connection((self.ip, self.port), timeout=self.timeout)
        self.socket.settimeout(self.timeout)
        self.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self._negotiate_session_key()

    def close(self) -> None:
        if self.socket:
            self.socket.close()
        self.socket = None

    def query_status(self, cid: str | None = None) -> dict[str, Any]:
        message = self._send_and_receive_non_empty(self._encode_message(self._next_sequence(), CMD_DP_QUERY_NEW, self._query_payload(cid)), True)
        return self._decode_payload(message.payload)

    def set_dps_value(self, dps_id: str, value: Any, cid: str | None = None) -> dict[str, Any]:
        message = self._send_and_receive_non_empty(self._encode_message(self._next_sequence(), CMD_CONTROL_NEW, self._control_payload(dps_id, value, cid)), True)
        if message.payload:
            response = self._decode_payload(message.payload)
            if _has_dps(response):
                return response
        return self.query_status(cid)

    def set_dps_value_nowait(self, dps_id: str, value: Any, cid: str | None = None) -> dict[str, Any]:
        self._write_message(self._encode_message(self._next_sequence(), CMD_CONTROL_NEW, self._control_payload(dps_id, value, cid)))
        time.sleep(0.01)
        return {}

    def _negotiate_session_key(self) -> None:
        response = self._send_and_receive_non_empty(self._encode_message(self._next_sequence(), CMD_SESS_KEY_NEG_START, LOCAL_NONCE), False)
        if response.command != CMD_SESS_KEY_NEG_RESP:
            raise OSError("Resposta invalida na negociacao da Tuya.")

        negotiation_payload = _aes_decrypt_padded(response.payload, self.real_local_key)
        if len(negotiation_payload) < 48:
            raise OSError("Payload curto na negociacao da Tuya.")

        remote_nonce = negotiation_payload[:16]
        received_local_hmac = negotiation_payload[16:48]
        expected_local_hmac = hmac.new(self.real_local_key, LOCAL_NONCE, hashlib.sha256).digest()
        if not hmac.compare_digest(expected_local_hmac, received_local_hmac):
            raise OSError("Falha ao validar o desafio da Tuya.")

        finish_hmac = hmac.new(self.real_local_key, remote_nonce, hashlib.sha256).digest()
        self._write_message(self._encode_message(self._next_sequence(), CMD_SESS_KEY_NEG_FINISH, finish_hmac))
        xor_nonce = bytes(left ^ right for left, right in zip(LOCAL_NONCE, remote_nonce))
        self.current_key = _aes_encrypt_no_pad(xor_nonce, self.real_local_key)

    def _send_and_receive_non_empty(self, message: bytes, allow_empty_ack: bool) -> ParsedMessage:
        self._write_message(message)
        last_message: ParsedMessage | None = None
        while True:
            next_message = self._read_message()
            last_message = next_message
            if next_message.payload:
                return next_message
            if allow_empty_ack:
                continue
        if last_message:
            return last_message
        raise TimeoutError("A Tuya nao respondeu a tempo.")

    def _write_message(self, message: bytes) -> None:
        if not self.socket:
            raise OSError("Socket Tuya nao conectado.")
        self.socket.sendall(message)

    def _read_message(self) -> ParsedMessage:
        header_bytes = self._read_fully(HEADER_SIZE)
        prefix, sequence, command, length = struct.unpack(">IIII", header_bytes)
        if prefix != PREFIX_55AA:
            raise OSError("Prefixo Tuya inesperado.")

        body = self._read_fully(length)
        if length < RETCODE_SIZE + HMAC_SIZE + SUFFIX_SIZE:
            raise OSError("Resposta Tuya invalida.")

        retcode = struct.unpack(">I", body[:RETCODE_SIZE])[0]
        payload_length = length - RETCODE_SIZE - HMAC_SIZE - SUFFIX_SIZE
        if payload_length < 0:
            raise OSError("Payload Tuya corrompido.")

        payload_end = RETCODE_SIZE + payload_length
        encrypted_payload = body[RETCODE_SIZE:payload_end]
        message_hmac = body[payload_end : payload_end + HMAC_SIZE]
        suffix = struct.unpack(">I", body[payload_end + HMAC_SIZE : payload_end + HMAC_SIZE + SUFFIX_SIZE])[0]
        if suffix != SUFFIX_55AA:
            raise OSError("Sufixo Tuya invalido.")

        hmac_source = header_bytes + body[:payload_end]
        expected_hmac = hmac.new(self.current_key, hmac_source, hashlib.sha256).digest()
        if not hmac.compare_digest(expected_hmac, message_hmac):
            raise OSError("Falha ao validar HMAC da Tuya.")

        return ParsedMessage(sequence, command, retcode, encrypted_payload)

    def _encode_message(self, sequence: int, command: int, json_payload: bytes) -> bytes:
        payload = json_payload if _skips_version_header(command) else VERSION_34_HEADER + json_payload
        encrypted_payload = _aes_encrypt_padded(payload, self.current_key)
        header = struct.pack(">IIII", PREFIX_55AA, sequence, command, len(encrypted_payload) + HMAC_SIZE + SUFFIX_SIZE)
        unsigned_message = header + encrypted_payload
        message_hmac = hmac.new(self.current_key, unsigned_message, hashlib.sha256).digest()
        return unsigned_message + message_hmac + struct.pack(">I", SUFFIX_55AA)

    def _decode_payload(self, payload: bytes) -> dict[str, Any]:
        if not payload:
            return {}
        plain_payload = _aes_decrypt_padded(payload, self.current_key)
        if plain_payload.startswith(VERSION_34_HEADER):
            plain_payload = plain_payload[len(VERSION_34_HEADER) :]
        json_string = plain_payload.rstrip(b"\x00").decode(errors="ignore").strip()
        try:
            decoded = json.loads(json_string)
        except json.JSONDecodeError:
            decoded = json.loads(_recover_json_object(json_string))
        if "dps" not in decoded and isinstance(decoded.get("data"), dict) and isinstance(decoded["data"].get("dps"), dict):
            decoded["dps"] = decoded["data"]["dps"]
        return decoded

    def _read_fully(self, length: int) -> bytes:
        if not self.socket:
            raise OSError("Socket Tuya nao conectado.")
        chunks = bytearray()
        while len(chunks) < length:
            chunk = self.socket.recv(length - len(chunks))
            if not chunk:
                raise OSError("A conexao Tuya foi encerrada.")
            chunks.extend(chunk)
        return bytes(chunks)

    def _next_sequence(self) -> int:
        sequence = self.sequence_number
        self.sequence_number += 1
        return sequence

    def _query_payload(self, cid: str | None) -> bytes:
        payload: dict[str, Any] = {}
        if cid:
            payload["cid"] = cid
        return _json_bytes(payload)

    def _control_payload(self, dps_id: str, value: Any, cid: str | None) -> bytes:
        data: dict[str, Any] = {"dps": {dps_id: value}}
        request: dict[str, Any] = {"protocol": 5, "t": int(time.time()), "data": data}
        if cid:
            data["cid"] = cid
            data["ctype"] = 0
            request["cid"] = cid
        return _json_bytes(request)


def _json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


def _has_dps(payload: dict[str, Any]) -> bool:
    return isinstance(payload.get("dps"), dict) and bool(payload["dps"])


def _skips_version_header(command: int) -> bool:
    return command in {CMD_DP_QUERY_NEW, CMD_SESS_KEY_NEG_START, CMD_SESS_KEY_NEG_RESP, CMD_SESS_KEY_NEG_FINISH}


def _recover_json_object(value: str) -> str:
    first_brace = value.find("{")
    last_brace = value.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        return value[first_brace : last_brace + 1]
    if ":" in value:
        return "{" + value.strip("{}") + "}"
    raise ValueError("Payload Tuya nao contem JSON valido.")


def _aes_encrypt_padded(payload: bytes, key: bytes) -> bytes:
    return _openssl_aes(payload, key, decrypt=False, padded=True)


def _aes_decrypt_padded(payload: bytes, key: bytes) -> bytes:
    return _openssl_aes(payload, key, decrypt=True, padded=True)


def _aes_encrypt_no_pad(payload: bytes, key: bytes) -> bytes:
    return _openssl_aes(payload, key, decrypt=False, padded=False)


def _openssl_aes(payload: bytes, key: bytes, decrypt: bool, padded: bool) -> bytes:
    command = ["openssl", "enc", "-aes-128-ecb", "-K", key.hex(), "-nosalt"]
    if decrypt:
        command.append("-d")
    if not padded:
        command.append("-nopad")
    result = subprocess.run(command, input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise ValueError(result.stderr.decode(errors="ignore").strip() or "Falha AES/OpenSSL.")
    return result.stdout
