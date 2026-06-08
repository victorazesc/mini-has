"use client";

import { Canvas } from "@react-three/fiber";
import {
  Bounds,
  Environment,
  Html,
  Line,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import {
  AirVent,
  Blinds,
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
  Power,
  Settings,
  Shield,
  Snowflake,
  Sun,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";

import { ClimateControl } from "@/components/capabilities/climate/control";
import { CoverControl } from "@/components/capabilities/cover/control";
import { Button } from "@/components/ui/button";
import { useDevices, useSendCommand } from "@/hooks/use-devices";
import type { SendCommandVariables } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/src/constants/devices_types";
import { useFloorDevicePositions, useFloors } from "@/hooks/use-floors";
import { useRooms } from "@/hooks/use-rooms";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import type { Device } from "@/src/services/devices.service";
import type { Floor } from "@/src/services/floors.service";
import type { Room } from "@/src/services/rooms.service";

type DeviceType = "light" | "climate" | "cover" | "sensor";
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
  device: Device;
  name: string;
  room: string;
  type: DeviceType;
  online: boolean;
  state?: string;
  position?: DevicePosition;
};

const DEVICE_Y = 3.39;

const DEVICE_TYPES: Record<DeviceType, { label: string; color: string }> = {
  light: { label: "Lâmpada", color: "#5eead4" },
  climate: { label: "Clima", color: "#22d3ee" },
  cover: { label: "Cortina", color: "#818cf8" },
  sensor: { label: "Sensor", color: "#facc15" },
};

function getDeviceVisualState(device: SpatialDevice): "on" | "off" | "offline" {
  if (!device.online) return "offline";
  if (device.type === "sensor") return "on";

  const state = String(device.state || "").toLowerCase();
  return ["on", "open", "opening", "closing", "active", "cool", "heat", "dry", "fan", "auto"].includes(state)
    ? "on"
    : "off";
}

function FloorModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    scene.traverse((object) => {
      object.raycast = () => null;
    });
  }, [scene]);

  return <primitive object={scene} />;
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
  floorRooms: Room[],
  positions: Record<number, DevicePosition>,
): SpatialDevice[] {
  const roomById = new Map(floorRooms.map((room) => [room.id, room]));
  const roomIds = new Set(roomById.keys());

  return devices
    .filter((device) => device.roomId !== null && roomIds.has(device.roomId))
    .map((device) => ({
      id: device.id,
      device,
      name: device.name,
      room:
        device.roomName ??
        (device.roomId ? roomById.get(device.roomId)?.name : null) ??
        "Sem cômodo",
      type: getDeviceType(device.deviceType),
      online: Boolean(device.status?.online),
      state: device.status?.state,
      position: positions[device.id],
    }));
}

function positionRowsToMap(
  rows: { deviceId: number; x: number; y: number; z: number }[],
) {
  return rows.reduce<Record<number, DevicePosition>>((acc, row) => {
    acc[row.deviceId] = [row.x, row.y || DEVICE_Y, row.z];
    return acc;
  }, {});
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
    <div className="space-y-4">
      <div>
        <p className="text-lg text-white/70">{date}</p>
        <div className="mt-3 flex items-center gap-4">
          <span className="text-4xl font-light leading-none">
            {weather ? `${Math.round(weather.temperature)}°C` : "--°C"}
          </span>
          <WeatherIcon code={weather?.weatherCode ?? -1} isDay={weather?.isDay ?? true} />
        </div>
        <p className="mt-3 text-lg text-white">
          {weather ? getWeatherDescription(weather.weatherCode) : "Atualizando clima..."}
        </p>
      </div>
    </div>
  );
}

function SummaryCard({ devices }: { devices: SpatialDevice[] }) {
  const activeDevices = devices.filter((device) => getDeviceVisualState(device) === "on").length;

  return (
    <section className="rounded-2xl border border-white/10 bg-black/35 p-4 text-white backdrop-blur">
      <h2 className="text-base font-semibold">Resumo da casa</h2>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <ListIcon className="size-4" />
            Dispositivos
          </span>
          <span>{devices.length}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <Circle className="size-4 text-emerald-400" />
            Ativos
          </span>
          <span>{activeDevices}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <TriangleAlert className="size-4 text-yellow-400" />
            Alertas
          </span>
          <span>0</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-3 text-white/90">
            <Shield className="size-4 text-red-500" />
            Segurança
          </span>
          <span className="text-red-500">Desativada</span>
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

function FloorSelector({
  deviceCounts,
  floors,
  selectedFloorId,
  onSelectFloor,
}: {
  deviceCounts: Record<number, number>;
  floors: Floor[];
  selectedFloorId: number | null;
  onSelectFloor: (floorId: number) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/45 p-5 text-white backdrop-blur">
      <h2 className="text-base font-semibold">Pisos</h2>
      <div className="mt-5 space-y-1.5">
        {floors.map((floor) => {
          const count = deviceCounts[floor.id] ?? 0;

          return (
            <button
              key={floor.id}
              className="flex h-9 w-full items-center justify-between rounded-full px-4 text-left text-base transition hover:bg-white/10 data-[active=true]:bg-white/15"
              data-active={selectedFloorId === floor.id}
              type="button"
              onClick={() => onSelectFloor(floor.id)}
            >
              <span>{floor.name}</span>
              <span className="text-white/80">
                {count} dispositivo{count === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
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
    visualState === "on" ? "Ligado" : visualState === "off" ? "Desligado" : "Offline";
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
      <Html center position={iconPosition}>
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
    <aside className="absolute right-6 top-[236px] z-20 w-[380px] max-w-[calc(100vw-3rem)] rounded-2xl border border-white/10 bg-black/75 p-4 text-white shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-white/45">{device.room}</p>
          <h2 className="mt-1 text-lg font-semibold">{device.name}</h2>
          <p className="mt-1 text-xs text-white/60">{type.label}</p>
        </div>
        <button
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

      <div className="mt-4 max-h-[calc(100vh-430px)] overflow-y-auto pr-1">
        <RealDeviceControl device={device.device} type={device.type} />
      </div>
    </aside>
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
        key={device.id}
        device={device as Device & { status: DeviceStatus }}
      />
    );
  }

  if (type === "sensor") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/8 p-3 text-sm text-white/65">
        Este dispositivo não possui controle acionável.
      </div>
    );
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

  if (device.type === "climate") {
    return [{
      deviceId: device.id,
      command: { command: "turn_off", params: {} },
    }];
  }

  if (device.type !== "light") return [];

  const activeChannels = getSwitchChannels(device.device).filter((channel) => channel.value);

  if (activeChannels.length) {
    return activeChannels.map((channel) => ({
      deviceId: device.id,
      command: {
        command: "set",
        params: { dpsId: channel.dpsId, value: false },
      },
    }));
  }

  return [{
    deviceId: device.id,
    command: { command: "turn_off", params: {} },
  }];
}

function QuickActions({ devices }: { devices: SpatialDevice[] }) {
  const { mutateAsync: sendCommand, isPending } = useSendCommand();
  const turnOffCommands = devices.flatMap(getTurnOffCommands);

  const turnOffAll = async () => {
    for (const command of turnOffCommands) {
      try {
        await sendCommand(command);
      } catch {
        // useSendCommand already reports the failed device command.
      }
    }
  };

  return (
    <div className="absolute bottom-5 left-6 z-20 flex gap-3">
      <button
        className="flex h-14 w-[250px] items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/70 px-4 text-left text-white backdrop-blur"
        type="button"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-emerald-400/15">
          <Lock className="size-5" />
        </span>
        <span>
          <span className="block text-base font-semibold">Segurança</span>
          <span className="text-sm text-emerald-300">Armar central de alarme</span>
        </span>
      </button>
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
  ].filter((item) => availableTypes.includes(item.type));

  return (
    <div className="absolute bottom-6 right-6 z-20 flex gap-3">
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
  const { setRightAction, setTitle } = useHeaderTitle();
  const { data: floors = [] } = useFloors();
  const { data: rooms = [] } = useRooms();
  const { data: devices = [] } = useDevices();
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [activeDeviceType, setActiveDeviceType] = useState<DeviceType | "all">("all");
  const { data: positionRows = [] } = useFloorDevicePositions(selectedFloorId);

  useEffect(() => {
    setTitle("Visão espacial");
    setRightAction(
      <Button size="icon" variant="ghost">
        <Settings className="size-5" />
      </Button>,
    );

    return () => {
      setTitle(null);
      setRightAction(null);
    };
  }, [setRightAction, setTitle]);

  useEffect(() => {
    if (!floors.length) {
      setSelectedFloorId(null);
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
  const floorRooms = useMemo(
    () => getFloorRooms(rooms, selectedFloorId),
    [rooms, selectedFloorId],
  );
  const positions = useMemo(() => positionRowsToMap(positionRows), [positionRows]);
  const deviceCountsByFloor = useMemo(() => {
    const floorByRoomId = new Map(
      rooms
        .filter((room) => room.floorId)
        .map((room) => [room.id, room.floorId as number]),
    );

    return devices.reduce<Record<number, number>>((acc, device) => {
      const floorId = device.roomId ? floorByRoomId.get(device.roomId) : null;

      if (floorId) {
        acc[floorId] = (acc[floorId] ?? 0) + 1;
      }

      return acc;
    }, {});
  }, [devices, rooms]);
  const floorDevices = useMemo(
    () => buildFloorDevices(devices, floorRooms, positions),
    [devices, floorRooms, positions],
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

  return (
    <main className="-my-4 min-h-[calc(100vh-var(--header-height))] overflow-hidden bg-[#050505] text-white md:-my-6">
      <div className="relative min-h-[calc(100vh-var(--header-height))]">
        <div className="absolute left-6 top-7 z-20 w-[280px] space-y-3">
          <WeatherPanel />
          <SummaryCard devices={floorDevices} />
          <EnergyCard />
        </div>

        <div className="absolute right-6 top-8 z-20 w-[320px]">
          <FloorSelector
            deviceCounts={deviceCountsByFloor}
            floors={floors}
            selectedFloorId={selectedFloorId}
            onSelectFloor={(floorId) => {
              setSelectedFloorId(floorId);
              setSelectedDeviceId(null);
              setActiveDeviceType("all");
            }}
          />
        </div>

        {selectedDevice ? (
          <DeviceControlPanel
            device={selectedDevice}
            onClose={() => setSelectedDeviceId(null)}
          />
        ) : null}

        <div className="absolute inset-0">
          <Canvas
            camera={{ position: [28, 16, 16], fov: 42 }}
            className="h-full w-full"
            onPointerMissed={() => setSelectedDeviceId(null)}
          >
            <ambientLight intensity={0.9} />
            <directionalLight position={[6, 12, 7]} intensity={1.4} />
            <Suspense fallback={null}>
              {selectedFloor?.modelUrl ? (
                <Bounds fit clip observe margin={1.55}>
                  <FloorModel url={selectedFloor.modelUrl} />
                </Bounds>
              ) : null}
              <Environment preset="apartment" />
            </Suspense>

            {visibleDevices.map((device) => (
              <DeviceMarker
                key={device.id}
                device={device}
                isSelected={selectedDeviceId === device.id}
                onSelect={() => setSelectedDeviceId(device.id)}
              />
            ))}

            <OrbitControls
              enableDamping
              enablePan
              enableRotate
              enableZoom
              makeDefault
              maxPolarAngle={Math.PI / 2.15}
              target={[20, 3, -2]}
            />
          </Canvas>
        </div>

        {!selectedFloor?.modelUrl ? (
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/60 px-8 py-6 text-center backdrop-blur">
            <p className="text-lg font-semibold">Sem modelo 3D neste piso</p>
            <p className="mt-2 text-sm text-white/50">
              Adicione um modelo na edição do piso.
            </p>
          </div>
        ) : null}

        <QuickActions devices={floorDevices} />
        <FilterDock
          activeType={activeDeviceType}
          availableTypes={availableDeviceTypes}
          onSelect={(type) => {
            setActiveDeviceType(type);
            setSelectedDeviceId(null);
          }}
        />
      </div>
    </main>
  );
}
