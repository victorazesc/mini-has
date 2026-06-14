"use client";

import { Canvas } from "@react-three/fiber";
import {
  Bounds,
  Environment,
  Html,
  Line,
} from "@react-three/drei";
import {
  AirVent,
  Blinds,
  Camera,
  Circle,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Grid2X2,
  Lightbulb,
  ListIcon,
  Lock,
  Move3D,
  PawPrint,
  Power,
  Printer,
  Rotate3D,
  Settings,
  Shield,
  Snowflake,
  Sun,
  TriangleAlert,
  View,
  X,
  Zap,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";

import { ClimateControl } from "@/components/capabilities/climate/control";
import { CoverControl } from "@/components/capabilities/cover/control";
import { LightControl } from "@/components/capabilities/light/control";
import { AlarmControl } from "@/components/capabilities/alarm/control";
import { CameraControl } from "@/components/capabilities/camera/control";
import { FeederControl } from "@/components/capabilities/feeder/control";
import { PrinterControl } from "@/components/capabilities/printer/control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSidebar } from "@/components/ui/sidebar";
import { useDevices, useSendCommand } from "@/hooks/use-devices";
import { useEntities } from "@/hooks/use-entities";
import type { SendCommandVariables } from "@/hooks/use-devices";
import { useAssetAvailability } from "@/hooks/use-asset-availability";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/src/constants/devices_types";
import { useFloorDevicePositions, useFloors } from "@/hooks/use-floors";
import { useRooms } from "@/hooks/use-rooms";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import type { Device } from "@/src/services/devices.service";
import type { Entity } from "@/src/services/entities.service";
import type { Floor, FloorDevicePosition } from "@/src/services/floors.service";
import type { Room } from "@/src/services/rooms.service";
import { CameraViewControls } from "./camera-view-controls";
import { FloorModel, FloorModelErrorBoundary } from "./floor-model";
import { SlideAlarmAction } from "../ui/slideAlarm";

type DeviceType = "light" | "climate" | "cover" | "sensor" | "alarm" | "feeder" | "camera" | "printer";
type DevicePosition = [number, number, number];

type WeatherData = {
  temperature: number;
  apparentTemperature: number | null;
  weatherCode: number;
  isDay: boolean;
  windSpeed: number | null;
  time: string;
  timezone: string | null;
};

type SpatialDevice = {
  id: number;
  deviceId: number;
  device: Device;
  entity?: Entity;
  name: string;
  room: string;
  type: DeviceType;
  online: boolean;
  state?: string;
  position?: DevicePosition;
};

const EMPTY_FLOORS: Floor[] = [];
const EMPTY_ROOMS: Room[] = [];
const EMPTY_DEVICES: Device[] = [];
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_FLOOR_POSITION_ROWS: FloorDevicePosition[] = [];

const DEVICE_Y = 3.39;

const DEVICE_TYPES: Record<DeviceType, { label: string; color: string }> = {
  light: { label: "Lâmpada", color: "#5eead4" },
  climate: { label: "Clima", color: "#22d3ee" },
  cover: { label: "Cortina", color: "#818cf8" },
  sensor: { label: "Sensor", color: "#facc15" },
  alarm: { label: "Central de alarme", color: "#34d399" },
  feeder: { label: "Alimentador", color: "#2dd4bf" },
  camera: { label: "Câmera", color: "#a78bfa" },
  printer: { label: "Impressora 3D", color: "#fb923c" },
};

function getDeviceVisualState(device: SpatialDevice): "on" | "off" | "offline" {
  if (!device.online) return "offline";
  if (device.type === "sensor") return "on";
  if (device.type === "feeder") return "on";
  if (device.type === "camera") return "on";
  if (device.type === "printer") return "on";
  if (device.type === "alarm") return ["armed", "partial"].includes(String(device.state || "").toLowerCase()) ? "on" : "off";

  const state = String(device.state || "").toLowerCase();
  return ["on", "open", "opening", "closing", "active", "cool", "heat", "dry", "fan", "auto"].includes(state)
    ? "on"
    : "off";
}

function getDeviceType(deviceType: string): DeviceType {
  const normalizedType = deviceType.toLowerCase();

  if (
    normalizedType.includes("climate") ||
    normalizedType.includes("air") ||
    normalizedType.includes("ar")
  ) {
    return "climate";
  }

  if (
    normalizedType.includes("cover") ||
    normalizedType.includes("curtain") ||
    normalizedType.includes("blind") ||
    normalizedType.includes("persiana")
  ) {
    return "cover";
  }

  if (normalizedType.includes("sensor")) {
    return "sensor";
  }

  if (normalizedType.includes("alarm") || normalizedType.includes("alarme")) {
    return "alarm";
  }

  if (normalizedType.includes("feeder") || normalizedType.includes("alimentador")) {
    return "feeder";
  }

  if (normalizedType.includes("camera") || normalizedType === "cam") {
    return "camera";
  }

  if (normalizedType.includes("printer") || normalizedType.includes("mainsail")) {
    return "printer";
  }

  return "light";
}

function getSelectedFloor(floors: Floor[], selectedFloorId: number | null) {
  return floors.find((floor) => floor.id === selectedFloorId) ?? null;
}

function getFloorRooms(rooms: Room[], selectedFloorId: number | null) {
  return selectedFloorId
    ? rooms.filter((room) => room.floorId === selectedFloorId)
    : [];
}

function buildFloorDevices(
  devices: Device[],
  entities: Entity[],
  floorRooms: Room[],
  positions: Record<number, DevicePosition>,
): SpatialDevice[] {
  const roomById = new Map(floorRooms.map((room) => [room.id, room]));
  const roomIds = new Set(roomById.keys());

  return devices
    .filter((device) => device.roomId !== null && roomIds.has(device.roomId))
    .flatMap((device) => {
      const room = device.roomName ?? (device.roomId ? roomById.get(device.roomId)?.name : null) ?? "Sem cômodo";
      const deviceEntities = entities.filter((entity) => entity.deviceId === device.id && entity.commandSchema.switchCode);
      if (deviceEntities.length > 1) {
        return deviceEntities.map((entity, index) => ({
          id: -entity.id,
          deviceId: device.id,
          device,
          entity,
          name: entity.name,
          room,
          type: "light" as const,
          online: Boolean(device.status?.online),
          state: entityState(entity),
          position: positions[-entity.id] ?? (index === 0 ? positions[device.id] : undefined),
        }));
      }
      return [{
        id: device.id,
        deviceId: device.id,
        device,
        name: device.name,
        room,
        type: getDeviceType(device.deviceType),
        online: Boolean(device.status?.online),
        state: device.status?.state,
        position: positions[device.id],
      }];
    });
}

function positionRowsToMap(
  rows: { deviceId: number; entityId?: number | null; x: number; y: number; z: number }[],
) {
  return rows.reduce<Record<number, DevicePosition>>((acc, row) => {
    acc[row.entityId ? -row.entityId : row.deviceId] = [row.x, row.y || DEVICE_Y, row.z];
    return acc;
  }, {});
}

function entityState(entity: Entity): string {
  const value = entity.state.value;
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value ?? entity.state.state ?? "off");
}

function entityDpsId(entity: Entity): string {
  const code = String(entity.commandSchema.switchCode || "switch");
  if (code === "switch_led") return "20";
  if (code === "switch") return "1";
  return code.startsWith("switch_") ? code.slice("switch_".length) : code;
}

function DeviceGlyph({
  className,
  type,
}: {
  className?: string;
  type: DeviceType;
}) {
  if (type === "climate") return <Snowflake className={className} />;
  if (type === "cover") return <Blinds className={className} />;
  if (type === "sensor") return <Move3D className={className} />;
  if (type === "alarm") return <Shield className={className} />;
  if (type === "feeder") return <PawPrint className={className} />;
  if (type === "camera") return <Camera className={className} />;
  if (type === "printer") return <Printer className={className} />;
  return <Lightbulb className={className} />;
}

function getWeatherDescription(code: number) {
  if (code === 0) return "Céu limpo";
  if (code <= 2) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if (code === 45 || code === 48) return "Neblina";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Chuva";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Neve";
  if (code >= 95) return "Tempestade";
  return "Condição indisponível";
}

function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }) {
  const className = "size-10 text-white";

  if (code === 0) return isDay ? <Sun className={className} /> : <CloudSun className={className} />;
  if (code <= 2) return <CloudSun className={className} />;
  if (code === 3) return <Cloud className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={className} />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <Snowflake className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  return <CloudSun className={className} />;
}

function WeatherPanel() {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWeather() {
      try {
        const response = await fetch("/api/weather", { signal: controller.signal });
        if (!response.ok) return;
        setWeather((await response.json()) as WeatherData);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Falha ao atualizar clima.", error);
        }
      }
    }

    void loadWeather();
    const interval = window.setInterval(loadWeather, 10 * 60 * 1000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(weather ? new Date(weather.time) : new Date())
    .replace(/^./, (letter) => letter.toUpperCase());

  return (
    <div className="space-y-2 sm:space-y-4">
      <div>
        <p className="text-sm text-white/70 sm:text-lg">{date}</p>
        <div className="mt-1 flex items-center gap-3 sm:mt-3 sm:gap-4">
          <span className="text-3xl font-light leading-none sm:text-4xl">
            {weather ? `${Math.round(weather.temperature)}°C` : "--°C"}
          </span>
          <WeatherIcon code={weather?.weatherCode ?? -1} isDay={weather?.isDay ?? true} />
        </div>
        <p className="mt-1 text-sm text-white sm:mt-3 sm:text-lg">
          {weather ? getWeatherDescription(weather.weatherCode) : "Atualizando clima..."}
        </p>
      </div>
    </div>
  );
}

function SummaryCard({ devices, alarmDevice }: { devices: SpatialDevice[]; alarmDevice?: Device }) {
  const activeDevices = devices.filter((device) => getDeviceVisualState(device) === "on").length;
  const alarmState = String(alarmDevice?.status?.state || "disarmed").toLowerCase();
  const alarmActive = ["armed", "partial"].includes(alarmState);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/45 p-3 text-white backdrop-blur sm:p-4">
      <h2 className="hidden text-base font-semibold sm:block">Resumo da casa</h2>
      <div className="grid grid-cols-4 gap-2 text-xs sm:mt-4 sm:block sm:space-y-3 sm:text-sm">
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between sm:gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <ListIcon className="size-4" />
            <span className="hidden sm:inline">Dispositivos</span>
          </span>
          <span>{devices.length}</span>
        </div>
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between sm:gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <Circle className="size-4 text-emerald-400" />
            <span className="hidden sm:inline">Ativos</span>
          </span>
          <span>{activeDevices}</span>
        </div>
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between sm:gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <TriangleAlert className="size-4 text-yellow-400" />
            <span className="hidden sm:inline">Alertas</span>
          </span>
          <span>0</span>
        </div>
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between sm:gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <Shield className="size-4 text-red-500" />
            <span className="hidden sm:inline">Segurança</span>
          </span>
          <span className={cn("max-w-full truncate", alarmActive ? "text-emerald-400" : "text-red-500")}>
            <span className="sm:hidden">{alarmActive ? "On" : "Off"}</span>
            <span className="hidden sm:inline">{alarmActive ? (alarmState === "partial" ? "Parcial" : "Armada") : "Desativada"}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function EnergyCard() {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/35 p-4 text-white backdrop-blur">
      <h2 className="text-base font-semibold">Geração de Energia</h2>
      <div className="mt-4">
        <div className="text-2xl font-semibold">4.2 kWh</div>
        <p className="mt-3 text-xs">
          <span className="text-emerald-400">+12%</span>{" "}
          <span className="text-white/85">vs ontem</span>
        </p>
      </div>
      <div className="mt-4 h-14 border-b border-l border-emerald-500/30 bg-[linear-gradient(to_right,rgba(16,185,129,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,185,129,0.18)_1px,transparent_1px)] bg-[size:33.3%_50%]">
        <svg
          aria-hidden="true"
          className="h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <path
            d="M0 80 C10 92 18 86 28 70 C42 48 53 62 70 36 C82 18 90 12 100 6"
            fill="none"
            stroke="#10b981"
            strokeLinecap="round"
            strokeWidth="3"
          />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-white/45">
        <span>00h</span>
        <span>12h</span>
        <span>24h</span>
      </div>
    </section>
  );
}

function DeviceMarker({
  device,
  isSelected,
  onSelect,
}: {
  device: SpatialDevice;
  isSelected: boolean;
  onSelect: () => void;
}) {
  if (!device.position) return null;

  const visualState = getDeviceVisualState(device);
  const stateLabel =
    device.type === "feeder"
      ? String(device.state || "").toLowerCase() === "feeding" ? "Servindo" : "Pronto"
      : visualState === "on" ? "Ligado" : visualState === "off" ? "Desligado" : "Offline";
  const color =
    visualState === "offline"
      ? "#ef4444"
      : visualState === "off"
        ? "#71717a"
        : DEVICE_TYPES[device.type].color;
  const basePosition: DevicePosition = [
    device.position[0],
    DEVICE_Y - 0.28,
    device.position[2],
  ];
  const iconPosition: DevicePosition = [
    device.position[0],
    DEVICE_Y + 1.45,
    device.position[2],
  ];

  return (
    <group>
      <Line color={color} lineWidth={1.5} points={[basePosition, iconPosition]} />
      <mesh position={basePosition}>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
      </mesh>
      <Html center position={iconPosition} zIndexRange={[10, 0]}>
        <button
          aria-label={`Abrir controle de ${device.name}, ${stateLabel}`}
          className={cn(
            "relative flex size-12 items-center justify-center rounded-full border transition data-[selected=true]:scale-110 data-[selected=true]:bg-white data-[selected=true]:text-black",
            visualState === "on" && "border-white/60 bg-[#0f2f28] text-white",
            visualState === "off" && "border-zinc-600 bg-zinc-900 text-zinc-500",
            visualState === "offline" && "border-red-500/70 bg-red-950 text-red-300",
          )}
          data-selected={isSelected}
          style={{
            boxShadow: visualState === "on" ? `0 0 22px ${color}80` : "none",
          }}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <DeviceGlyph className="size-6" type={device.type} />
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 size-3 rounded-full border-2 border-black"
            style={{ backgroundColor: color }}
          />
        </button>
      </Html>
    </group>
  );
}

function DeviceControlPanel({
  device,
  onClose,
}: {
  device: SpatialDevice;
  onClose: () => void;
}) {
  const type = DEVICE_TYPES[device.type];
  const lastSeenAt = device.device.status?.lastSeenAt
    ? new Date(device.device.status.lastSeenAt).toLocaleString("pt-BR")
    : "Sem registro";

  return (
    <aside className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex max-h-[72dvh] w-auto flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/90 p-4 text-white shadow-2xl backdrop-blur lg:absolute lg:inset-x-auto lg:bottom-20 lg:right-5 lg:top-5 lg:max-h-none lg:w-[380px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-white/45">{device.room}</p>
          <h2 className="mt-1 text-lg font-semibold">{device.name}</h2>
          <p className="mt-1 text-xs text-white/60">{type.label}</p>
        </div>
        <button
          aria-label="Fechar controle do dispositivo"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          type="button"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white/8 p-3">
          <p className="text-white/45">Status</p>
          <p className="mt-1 font-medium">{device.online ? "Online" : "Offline"}</p>
        </div>
        <div className="rounded-xl bg-white/8 p-3">
          <p className="text-white/45">Estado</p>
          <p className="mt-1 font-medium">{device.state || "-"}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white/8 p-3 text-xs">
        <p className="text-white/45">Último visto</p>
        <p className="mt-1">{lastSeenAt}</p>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {device.entity ? <EntitySwitchControl device={device.device} entity={device.entity} /> : <RealDeviceControl device={device.device} type={device.type} />}
      </div>
    </aside>
  );
}

function EntitySwitchControl({ device, entity }: { device: Device; entity: Entity }) {
  const { mutate: sendCommand, isPending } = useSendCommand();
  const isOn = entityState(entity) === "on";

  return (
    <button
      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/8 p-3 text-left transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      type="button"
      onClick={() => sendCommand({
        deviceId: device.id,
        command: { command: "set", params: { dpsId: entityDpsId(entity), value: !isOn } },
      })}
    >
      <span>
        <span className="block text-sm font-medium">{entity.name}</span>
        <span className="text-xs text-white/45">{isOn ? "Ligado" : "Desligado"}</span>
      </span>
      <Power className="size-5" />
    </button>
  );
}

type SwitchChannel = {
  dpsId: string;
  label: string;
  value: boolean;
};

function getSwitchChannels(device: Device): SwitchChannel[] {
  const statusEntries = Array.isArray(device.capabilities?.status)
    ? device.capabilities.status
    : [];
  const runtimeDps = device.status?.dps ?? {};

  return statusEntries
    .filter((entry): entry is { code: string; value: boolean } => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as { code?: unknown; value?: unknown };

      return (
        typeof candidate.code === "string" &&
        candidate.code.startsWith("switch_") &&
        typeof candidate.value === "boolean"
      );
    })
    .map((entry) => {
      const dpsId = entry.code.replace("switch_", "");
      const runtimeValue = runtimeDps[dpsId];

      return {
        dpsId,
        label: `Switch ${dpsId}`,
        value: typeof runtimeValue === "boolean" ? runtimeValue : entry.value,
      };
    });
}

function RealDeviceControl({
  device,
  type,
}: {
  device: Device;
  type: DeviceType;
}) {
  if (type === "cover") {
    return <CoverControl key={device.id} device={device} />;
  }

  if (type === "climate") {
    return (
      <ClimateControl
        compact
        key={device.id}
        device={device as Device & { status: DeviceStatus }}
      />
    );
  }

  if (type === "feeder") {
    return <FeederControl compact device={device} />;
  }

  if (type === "camera") {
    return <CameraControl compact device={device} />;
  }

  if (type === "printer") {
    return <PrinterControl compact device={device} />;
  }

  if (type === "sensor") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/8 p-3 text-sm text-white/65">
        Este dispositivo não possui controle acionável.
      </div>
    );
  }

  if (type === "alarm") {
    return <AlarmControl compact device={device} />;
  }

  const normalizedType = device.deviceType.toLowerCase();
  if (type === "light" && (normalizedType.includes("light") || normalizedType.includes("lamp"))) {
    return <LightControl compact device={device} />;
  }

  return <SwitchDeviceControl device={device} />;
}

function SwitchDeviceControl({ device }: { device: Device }) {
  const { mutate: sendCommand, isPending } = useSendCommand();
  const channels = getSwitchChannels(device);
  const isOn = device.status?.state === "on";

  const togglePower = () => {
    sendCommand({
      deviceId: device.id,
      command: {
        command: isOn ? "turn_off" : "turn_on",
        params: {},
      },
    });
  };

  const toggleChannel = (channel: SwitchChannel) => {
    sendCommand({
      deviceId: device.id,
      command: {
        command: "set",
        params: {
          dpsId: channel.dpsId,
          value: !channel.value,
        },
      },
    });
  };

  return (
    <div className="space-y-3">
      {channels.length === 0 ? (
        <button
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/8 p-3 text-left transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="button"
          onClick={togglePower}
        >
          <span>
            <span className="block text-sm font-medium">Liga/desliga</span>
            <span className="text-xs text-white/45">
              {isOn ? "Ligado" : "Desligado"}
            </span>
          </span>
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-full",
              isOn ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/55",
            )}
          >
            <Power className="size-4" />
          </span>
        </button>
      ) : (
        channels.map((channel) => (
          <button
            key={channel.dpsId}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/8 p-3 text-left transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            type="button"
            onClick={() => toggleChannel(channel)}
          >
            <span>
              <span className="block text-sm font-medium">{channel.label}</span>
              <span className="text-xs text-white/45">
                {channel.value ? "Ligado" : "Desligado"}
              </span>
            </span>
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                channel.value
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-white/10 text-white/55",
              )}
            >
              <Power className="size-4" />
            </span>
          </button>
        ))
      )}

    </div>
  );
}

function getTurnOffCommands(device: SpatialDevice): SendCommandVariables[] {
  if (!device.online || getDeviceVisualState(device) !== "on") return [];

  if (device.entity) {
    return [{
      deviceId: device.deviceId,
      command: { command: "set", params: { dpsId: entityDpsId(device.entity), value: false } },
    }];
  }

  if (device.type === "climate") {
    return [{
      deviceId: device.deviceId,
      command: { command: "turn_off", params: {} },
    }];
  }

  if (device.type !== "light") return [];

  const activeChannels = getSwitchChannels(device.device).filter((channel) => channel.value);

  if (activeChannels.length) {
    return activeChannels.map((channel) => ({
      deviceId: device.deviceId,
      command: {
        command: "set",
        params: { dpsId: channel.dpsId, value: false },
      },
    }));
  }

  return [{
    deviceId: device.deviceId,
    command: { command: "turn_off", params: {} },
  }];
}

function QuickActions({ devices, alarmDevice }: { devices: SpatialDevice[]; alarmDevice?: Device }) {
  const { mutateAsync: sendCommand, isPending } = useSendCommand();
  const turnOffCommands = devices.flatMap(getTurnOffCommands);
  const alarmArmed = ["armed", "partial"].includes(String(alarmDevice?.status?.state || "").toLowerCase());

  const turnOffAll = async () => {
    for (const command of turnOffCommands) {
      try {
        await sendCommand(command);
      } catch {
        // useSendCommand already reports the failed device command.
      }
    }
  };

  const [alarmStatus, setAlarmStatus] = useState<"armed" | "disarmed" | "arming" | "disarming" | "unknown">("disarmed");
  const activateAlarm = async () => {
    if (!alarmDevice) return;
    if (alarmArmed && !window.confirm("Desarmar a central de alarme?")) return;
    setAlarmStatus("arming");
    try {
      await sendCommand({
        deviceId: alarmDevice.id,
        command: {
          command: "arm",
          params: {},
        },
      });

      setAlarmStatus("armed");
    } catch (error) {
      setAlarmStatus("disarmed");
      throw error;
    };
  };
  const deactivateAlarm = async () => {
    if (!alarmDevice) return;
    if (alarmArmed && !window.confirm("Desarmar a central de alarme?")) return;
    setAlarmStatus("disarming");
    try {
      await sendCommand({
        deviceId: alarmDevice.id,
        command: {
          command: "disarm",
          params: {},
        },
      });

      setAlarmStatus("disarmed");
    } catch (error) {
      setAlarmStatus("disarmed");
      throw error;
    };
  };

  useEffect(() => {
    if (!alarmDevice) {
      setAlarmStatus("unknown");
    } else if (["armed", "partial"].includes(String(alarmDevice.status?.state || "").toLowerCase())) {
      setAlarmStatus("armed");
    } else {
      setAlarmStatus("disarmed");
    }
  }, [alarmDevice]);
  return (
    <div className="absolute bottom-5 left-6 z-20 hidden gap-3 md:flex">
      <SlideAlarmAction
        status={alarmStatus}
        onArm={activateAlarm}
        onDisarm={deactivateAlarm}
      />
      <button
        className="flex h-14 w-[250px] items-center gap-3 rounded-2xl border border-white/10 bg-black/45 px-4 text-left text-white backdrop-blur disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending || turnOffCommands.length === 0}
        type="button"
        onClick={turnOffAll}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-white/10">
          <Power className="size-5" />
        </span>
        <span>
          <span className="block text-base font-semibold">
            {isPending ? "Desligando..." : "Desligar tudo"}
          </span>
          <span className="text-sm text-white/45">Todos os dispositivos</span>
        </span>
      </button>
    </div>
  );
}

function FilterDock({
  activeType,
  availableTypes,
  onSelect,
}: {
  activeType: DeviceType | "all";
  availableTypes: DeviceType[];
  onSelect: (type: DeviceType | "all") => void;
}) {
  const items = [
    { icon: Lightbulb, label: "Luzes", type: "light" as const },
    { icon: AirVent, label: "Clima", type: "climate" as const },
    { icon: Blinds, label: "Cortinas", type: "cover" as const },
    { icon: Move3D, label: "Sensores", type: "sensor" as const },
    { icon: PawPrint, label: "Alimentadores", type: "feeder" as const },
    { icon: Camera, label: "Câmeras", type: "camera" as const },
    { icon: Printer, label: "Impressoras", type: "printer" as const },
  ].filter((item) => availableTypes.includes(item.type));

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/45 p-1 backdrop-blur md:inset-x-auto md:bottom-6 md:right-6 md:gap-3 md:overflow-visible md:border-0 md:bg-transparent md:p-0">
      {[...items, { icon: Grid2X2, label: "Todos", type: "all" as const }].map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white backdrop-blur transition hover:bg-white/10 data-[active=true]:bg-white/15"
            data-active={activeType === item.type}
            type="button"
            onClick={() => onSelect(item.type)}
          >
            <Icon className="size-5" />
            <span className="sr-only">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SpatialDashboard() {
  const router = useRouter();
  const { setRightAction, setTitle } = useHeaderTitle();
  const { setOpen, setOpenMobile } = useSidebar();
  const { data: floors = EMPTY_FLOORS } = useFloors();
  const { data: rooms = EMPTY_ROOMS } = useRooms();
  const { data: devices = EMPTY_DEVICES } = useDevices();
  const { data: entities = EMPTY_ENTITIES } = useEntities();
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [activeDeviceType, setActiveDeviceType] = useState<DeviceType | "all">("all");
  const [cameraActions, setCameraActions] = useState<{
    topView: () => void;
    defaultView: () => void;
    focusDevice: (position: DevicePosition) => void;
  } | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const { data: positionRows = EMPTY_FLOOR_POSITION_ROWS } = useFloorDevicePositions(selectedFloorId);

  useEffect(() => {
    setTitle(
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="hidden sm:inline">Visão espacial</span>
        <Select
          disabled={!floors.length}
          value={selectedFloorId ? String(selectedFloorId) : null}
          onValueChange={(value) => {
            setSelectedFloorId(Number(value));
            setSelectedDeviceId(null);
            setActiveDeviceType("all");
          }}
        >
          <SelectTrigger
            aria-label="Selecionar piso"
            className="w-32 border border-border bg-background/80 px-2 sm:w-44 sm:px-3"
            size="sm"
          >
            <SelectValue placeholder="Selecionar piso">
              {getSelectedFloor(floors, selectedFloorId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {floors.map((floor) => (
              <SelectItem key={floor.id} value={String(floor.id)}>
                {floor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>,
    );
    setRightAction(
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden rounded-full border border-border p-0.5 sm:flex">
          <Button
            className="rounded-full px-3"
            onClick={() => cameraActions?.topView()}
            size="sm"
            variant="ghost"
          >
            <View className="size-4" />
            Topo
          </Button>
          <Button
            className="rounded-full px-3"
            onClick={() => cameraActions?.defaultView()}
            size="sm"
            variant="ghost"
          >
            <Rotate3D className="size-4" />
            Isométrica
          </Button>
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <Button
          aria-label="Editar piso selecionado"
          disabled={!selectedFloorId}
          onClick={() => router.push(`/floor-editor?floorId=${selectedFloorId}`)}
          size="icon"
          variant="ghost"
        >
          <Settings className="size-5" />
        </Button>
      </div>,
    );

    return () => {
      setTitle(null);
      setRightAction(null);
    };
  }, [cameraActions, floors, router, selectedFloorId, setRightAction, setTitle]);

  useEffect(() => {
    if (!floors.length) {
      if (selectedFloorId !== null) {
        setSelectedFloorId(null);
      }
      return;
    }

    if (!selectedFloorId || !floors.some((floor) => floor.id === selectedFloorId)) {
      setSelectedFloorId(floors[0].id);
    }
  }, [floors, selectedFloorId]);

  const selectedFloor = useMemo(
    () => getSelectedFloor(floors, selectedFloorId),
    [floors, selectedFloorId],
  );
  const selectedFloorModelUrl = selectedFloor?.modelUrl ?? null;
  const modelAvailability = useAssetAvailability(selectedFloorModelUrl);
  const [failedModelUrl, setFailedModelUrl] = useState<string | null>(null);
  const availableModelUrl = selectedFloorModelUrl && modelAvailability === "available" && failedModelUrl !== selectedFloorModelUrl
    ? selectedFloorModelUrl
    : null;
  const isModelUnavailable = Boolean(
    selectedFloorModelUrl && (modelAvailability === "unavailable" || failedModelUrl === selectedFloorModelUrl),
  );
  const floorRooms = useMemo(
    () => getFloorRooms(rooms, selectedFloorId),
    [rooms, selectedFloorId],
  );
  const positions = useMemo(() => positionRowsToMap(positionRows), [positionRows]);
  const floorDevices = useMemo(
    () => buildFloorDevices(devices, entities, floorRooms, positions),
    [devices, entities, floorRooms, positions],
  );
  const positionedDevices = useMemo(
    () => floorDevices.filter((device) => device.position),
    [floorDevices],
  );
  const availableDeviceTypes = useMemo(
    () => Array.from(new Set(positionedDevices.map((device) => device.type))),
    [positionedDevices],
  );
  const visibleDevices = useMemo(
    () => activeDeviceType === "all"
      ? positionedDevices
      : positionedDevices.filter((device) => device.type === activeDeviceType),
    [activeDeviceType, positionedDevices],
  );
  const selectedDevice = useMemo(
    () => floorDevices.find((device) => device.id === selectedDeviceId) ?? null,
    [floorDevices, selectedDeviceId],
  );
  const alarmDevice = useMemo(
    () => devices.find((device) => device.provider === "intelbras_amt8000"),
    [devices],
  );

  useEffect(() => {
    setFailedModelUrl(null);
  }, [selectedFloorModelUrl]);

  useEffect(() => {
    if (selectedDeviceId && !floorDevices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(null);
    }
  }, [floorDevices, selectedDeviceId]);

  useEffect(() => {
    if (activeDeviceType !== "all" && !availableDeviceTypes.includes(activeDeviceType)) {
      setActiveDeviceType("all");
    }
  }, [activeDeviceType, availableDeviceTypes]);

  function closeSelectedDevice() {
    if (!selectedDeviceId) return;

    setSelectedDeviceId(null);
    cameraActions?.topView();
  }

  function selectDevice(device: SpatialDevice) {
    setOpen(false);
    setOpenMobile(false);
    setSelectedDeviceId(device.id);

    if (device.position) {
      cameraActions?.focusDevice(device.position);
    }
  }

  return (
    <main className="-my-3 min-h-[calc(100dvh-var(--header-height)-5rem)] overflow-hidden bg-background md:-my-6 md:min-h-[calc(100vh-var(--header-height))]">
      <div className="relative min-h-[calc(100dvh-var(--header-height)-5rem)] md:min-h-[calc(100vh-var(--header-height))]">
        <div className="absolute left-3 right-3 top-3 z-20 space-y-2 sm:left-6 sm:right-auto sm:top-7 sm:w-[280px] sm:space-y-3">
          <WeatherPanel />
          <SummaryCard alarmDevice={alarmDevice} devices={floorDevices} />
          <div className="hidden md:block">
            <EnergyCard />
          </div>
        </div>

        {selectedDevice ? (
          <DeviceControlPanel
            device={selectedDevice}
            onClose={closeSelectedDevice}
          />
        ) : null}

        <div
          className={cn(
            "absolute inset-y-0 left-0 right-0 overflow-hidden transition-[right] duration-200 lg:left-[320px]",
            "bg-background",
            selectedDevice && "lg:right-[420px]",
          )}
        >

          <div className="pointer-events-none absolute inset-0 bg-background" />

          {/* Glow central usando cor da sidebar */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_oklch,var(--sidebar)_92%,transparent)_0%,color-mix(in_oklch,var(--sidebar)_48%,transparent)_34%,transparent_72%)]" />

          {/* Grid grande com fade no centro */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_70%,transparent)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(circle_at_center,transparent_0%,black_38%,black_100%)]" />

          {/* Grid fino mais sutil */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_32%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_32%,transparent)_1px,transparent_1px)] bg-[size:20px_20px] [mask-image:radial-gradient(circle_at_center,transparent_0%,black_42%,black_100%)]" />

          {/* Vignette nas bordas */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_48%,color-mix(in_oklch,var(--background)_92%,transparent)_100%)]" />
          <div className="relative z-10 h-full w-full">
            <Canvas
              camera={{ position: [28, 16, 16], fov: 42 }}
              className="h-full w-full"
              onPointerMissed={closeSelectedDevice}
            >
              <ambientLight intensity={0.9} />
              <directionalLight position={[6, 12, 7]} intensity={1.4} />
              <Suspense fallback={null}>
                {availableModelUrl ? (
                  <group ref={modelGroupRef}>
                    <Bounds fit clip margin={1.55}>
                      <FloorModelErrorBoundary
                        resetKey={availableModelUrl}
                        onError={() => setFailedModelUrl(availableModelUrl)}
                      >
                        <FloorModel url={availableModelUrl} />
                      </FloorModelErrorBoundary>
                    </Bounds>
                    {visibleDevices.map((device) => (
                      <DeviceMarker
                        key={device.id}
                        device={device}
                        isSelected={selectedDeviceId === device.id}
                        onSelect={() => selectDevice(device)}
                      />
                    ))}
                  </group>
                ) : null}
                <Environment preset="apartment" />
              </Suspense>
              <CameraViewControls
                focusScale={1.65}
                modelRef={modelGroupRef}
                onReady={setCameraActions}
                viewScale={0.72}
              />
            </Canvas>
          </div>
        </div>

        {!selectedFloorModelUrl ? (
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/60 px-8 py-6 text-center backdrop-blur">
            <p className="text-lg font-semibold">Sem modelo 3D neste piso</p>
            <p className="mt-2 text-sm text-white/50">
              Adicione um modelo na edição do piso.
            </p>
          </div>
        ) : null}

        {isModelUnavailable ? (
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/60 px-8 py-6 text-center backdrop-blur">
            <p className="text-lg font-semibold">Modelo 3D indisponível</p>
            <p className="mt-2 text-sm text-white/50">
              Envie o modelo novamente na edição do piso.
            </p>
          </div>
        ) : null}

        <QuickActions alarmDevice={alarmDevice} devices={floorDevices} />
        {!selectedDevice ? (
          <FilterDock
            activeType={activeDeviceType}
            availableTypes={availableDeviceTypes}
            onSelect={(type) => {
              setActiveDeviceType(type);
              setSelectedDeviceId(null);
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
