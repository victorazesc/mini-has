#!/usr/bin/env python3
"""Publish a persistent mDNS CNAME through Avahi's D-Bus API."""

import argparse
import os
import signal
import socket
import sys
import time

import dbus


AVAHI_DBUS_NAME = "org.freedesktop.Avahi"
AVAHI_SERVER_PATH = "/"
AVAHI_SERVER_INTERFACE = "org.freedesktop.Avahi.Server"
AVAHI_ENTRY_GROUP_INTERFACE = "org.freedesktop.Avahi.EntryGroup"
AVAHI_IF_UNSPEC = -1
AVAHI_PROTO_UNSPEC = -1
DNS_CLASS_IN = 1
DNS_TYPE_CNAME = 5
ENTRY_GROUP_REGISTERING = 1
ENTRY_GROUP_ESTABLISHED = 2
ENTRY_GROUP_COLLISION = 3
ENTRY_GROUP_FAILURE = 4
STOP_REQUESTED = False


def normalize_mdns_name(value: str) -> str:
    name = value.rstrip(".")
    labels = name.split(".")
    encoded_labels: list[str] = []

    if not name or any(not label for label in labels):
        raise argparse.ArgumentTypeError(f"nome mDNS invalido: {value}")

    for label in labels:
        try:
            encoded = label.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise argparse.ArgumentTypeError(f"nome mDNS invalido: {value}") from error
        if (
            len(encoded) > 63
            or encoded.startswith("-")
            or encoded.endswith("-")
            or not encoded.replace("-", "").isalnum()
        ):
            raise argparse.ArgumentTypeError(f"nome mDNS invalido: {value}")
        encoded_labels.append(encoded)

    normalized = ".".join(encoded_labels)
    if len(normalized.encode("ascii")) > 253 or encoded_labels[-1].lower() != "local":
        raise argparse.ArgumentTypeError(f"nome mDNS invalido: {value}")
    return normalized


def encode_dns_name(name: str) -> bytes:
    encoded = bytearray()
    for label in name.split("."):
        label_bytes = label.encode("ascii")
        encoded.append(len(label_bytes))
        encoded.extend(label_bytes)
    encoded.append(0)
    return bytes(encoded)


def notify_systemd(alias: str, target: str) -> None:
    notify_socket = os.environ.get("NOTIFY_SOCKET")
    if not notify_socket:
        return
    address = f"\0{notify_socket[1:]}" if notify_socket.startswith("@") else notify_socket
    message = f"READY=1\nSTATUS=Publicando {alias} -> {target}".encode()
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
        client.connect(address)
        client.sendall(message)


def request_stop(_signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def publish(alias: str, target: str, ttl: int) -> None:
    bus = dbus.SystemBus()
    server = dbus.Interface(
        bus.get_object(AVAHI_DBUS_NAME, AVAHI_SERVER_PATH),
        AVAHI_SERVER_INTERFACE,
    )
    group_path = server.EntryGroupNew()
    group = dbus.Interface(
        bus.get_object(AVAHI_DBUS_NAME, group_path),
        AVAHI_ENTRY_GROUP_INTERFACE,
    )

    try:
        group.AddRecord(
            dbus.Int32(AVAHI_IF_UNSPEC),
            dbus.Int32(AVAHI_PROTO_UNSPEC),
            dbus.UInt32(0),
            alias,
            dbus.UInt16(DNS_CLASS_IN),
            dbus.UInt16(DNS_TYPE_CNAME),
            dbus.UInt32(ttl),
            dbus.ByteArray(encode_dns_name(target)),
        )
        group.Commit()

        deadline = time.monotonic() + 15
        while not STOP_REQUESTED:
            state = int(group.GetState())
            if state == ENTRY_GROUP_ESTABLISHED:
                break
            if state == ENTRY_GROUP_COLLISION:
                raise RuntimeError(f"colisao ao publicar {alias}")
            if state == ENTRY_GROUP_FAILURE:
                raise RuntimeError(f"Avahi falhou ao publicar {alias}")
            if time.monotonic() >= deadline:
                raise RuntimeError(f"timeout ao publicar {alias}")
            time.sleep(0.2)
        else:
            return

        notify_systemd(alias, target)
        print(f"mDNS publicado: {alias} -> {target}", flush=True)

        while not STOP_REQUESTED:
            time.sleep(2)
            state = int(group.GetState())
            if state in (ENTRY_GROUP_REGISTERING, ENTRY_GROUP_ESTABLISHED):
                continue
            if state == ENTRY_GROUP_COLLISION:
                raise RuntimeError(f"colisao ao manter {alias}")
            raise RuntimeError(f"publicacao mDNS saiu do estado valido: {state}")
    finally:
        try:
            group.Free()
        except dbus.DBusException:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--alias", required=True, type=normalize_mdns_name)
    parser.add_argument("--target", required=True, type=normalize_mdns_name)
    parser.add_argument("--ttl", type=int, default=120)
    args = parser.parse_args()

    if args.alias.lower() == args.target.lower():
        parser.error("alias e destino devem ser diferentes")
    if not 1 <= args.ttl <= 0xFFFFFFFF:
        parser.error("TTL deve estar entre 1 e 4294967295")

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        publish(args.alias, args.target, args.ttl)
    except (dbus.DBusException, OSError, RuntimeError) as error:
        print(f"ERRO: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
