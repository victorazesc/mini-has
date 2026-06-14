"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bounds,
  Environment,
  Grid,
  Html,
  Line,
  TransformControls,
} from "@react-three/drei";
import {
  AirVent,
  Blinds,
  Camera,
  Check,
  Grid2X2,
  Lightbulb,
  ListPlus,
  Move3D,
  Printer,
  Rotate3D,
  Redo2,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  Undo2,
  View,
  X,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DoubleSide, Group } from "three";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDevices } from "@/hooks/use-devices";
import { useEntities } from "@/hooks/use-entities";
import { useAssetAvailability } from "@/hooks/use-asset-availability";
import {
  useFloorDevicePositions,
  useFloors,
  useReplaceFloorDevicePositions,
} from "@/hooks/use-floors";
import { useRooms } from "@/hooks/use-rooms";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import type { Device } from "@/src/services/devices.service";
import type { Entity } from "@/src/services/entities.service";
import type { Floor, FloorDevicePosition } from "@/src/services/floors.service";
import type { Room } from "@/src/services/rooms.service";
import {
  CameraViewControls,
  type CameraActions,
} from "@/components/3d/camera-view-controls";
import { FloorModel, FloorModelErrorBoundary } from "@/components/3d/floor-model";

type DeviceType = "light" | "climate" | "cover" | "sensor" | "camera" | "printer";
type DeviceFilter = DeviceType | "all";
type DevicePosition = [number, number, number];

type FloorDevice = {
  id: number;
  deviceId: number;
  entityId?: number;
  name: string;
  room: string;
  type: DeviceType;
  position?: DevicePosition;
  dirty?: boolean;
};

const EMPTY_FLOORS: Floor[] = [];
const EMPTY_ROOMS: Room[] = [];
const EMPTY_DEVICES: Device[] = [];
const EMPTY_ENTITIES: Entity[] = [];
const EMPTY_FLOOR_POSITION_ROWS: FloorDevicePosition[] = [];

type Point2 = {
  x: number;
  z: number;
};

const EDITOR_CENTER = {
  x: 20,
  z: -2,
};
const EDITOR_Y = 3.05;
const DEVICE_Y = EDITOR_Y + 0.34;
const GRID_SIZE = 28;
const SNAP_STEP = 0.5;
const DEFAULT_DEVICE_POSITION: DevicePosition = [20, DEVICE_Y, -2];

const DEVICE_TYPES: Record<
  DeviceType,
  {
    label: string;
    color: string;
  }
> = {
  light: {
    label: "Lâmpada",
    color: "#5eead4",
  },
  climate: {
    label: "Clima",
    color: "#22d3ee",
  },
  cover: {
    label: "Cortina",
    color: "#818cf8",
  },
  sensor: {
    label: "Sensor",
    color: "#facc15",
  },
  camera: {
    label: "Câmera",
    color: "#a78bfa",
  },
  printer: {
    label: "Impressora 3D",
    color: "#fb923c",
  },
};

type DevicePositionState = Record<
  number,
  {
    dirty: boolean;
    position: DevicePosition;
  }
>;

function DeviceGlyph({
  className,
  type,
}: {
  className?: string;
  type: DeviceType;
}) {
  if (type === "climate") {
    return <AirVent className={className} />;
  }

  if (type === "cover") {
    return <Blinds className={className} />;
  }

  if (type === "sensor") {
    return <Move3D className={className} />;
  }

  if (type === "camera") {
    return <Camera className={className} />;
  }

  if (type === "printer") {
    return <Printer className={className} />;
  }

  return <Lightbulb className={className} />;
}

function getDeviceEditorType(deviceType: string): DeviceType {
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

function parseFloorId(floorId: string | null | undefined) {
  const parsedFloorId = Number(floorId);

  return Number.isFinite(parsedFloorId) ? parsedFloorId : null;
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
  positions: DevicePositionState,
): FloorDevice[] {
  const roomById = new Map(floorRooms.map((room) => [room.id, room]));
  const roomIds = new Set(roomById.keys());

  return devices
    .filter((device) => device.roomId !== null && roomIds.has(device.roomId))
    .flatMap((device) => {
      const room = device.roomName ?? (device.roomId ? roomById.get(device.roomId)?.name : null) ?? "Sem cômodo";
      const deviceEntities = entities.filter((entity) => entity.deviceId === device.id && entity.commandSchema.switchCode);

      if (deviceEntities.length > 1) {
        return deviceEntities.map((entity, index) => {
          const positionState = positions[-entity.id] ?? (index === 0 ? positions[device.id] : undefined);
          return {
            id: -entity.id,
            deviceId: device.id,
            entityId: entity.id,
            name: entity.name,
            room,
            type: "light" as const,
            dirty: positionState?.dirty,
            position: positionState?.position,
          };
        });
      }

      const positionState = positions[device.id];
      return [{
        id: device.id,
        deviceId: device.id,
        name: device.name,
        room,
        type: getDeviceEditorType(device.deviceType),
        dirty: positionState?.dirty,
        position: positionState?.position,
      }];
    });
}

function positionsFromRows(
  rows: {
    deviceId: number;
    entityId?: number | null;
    x: number;
    y: number;
    z: number;
  }[],
): DevicePositionState {
  return Object.fromEntries(
    rows.map((position) => [
      position.entityId ? -position.entityId : position.deviceId,
      {
        dirty: false,
        position: [position.x, position.y, position.z] as DevicePosition,
      },
    ]),
  );
}

function areDevicePositionsEqual(
  currentPositions: DevicePositionState,
  nextPositions: DevicePositionState,
) {
  const currentIds = Object.keys(currentPositions);
  const nextIds = Object.keys(nextPositions);

  if (currentIds.length !== nextIds.length) return false;

  return currentIds.every((deviceId) => {
    const current = currentPositions[Number(deviceId)];
    const next = nextPositions[Number(deviceId)];

    return Boolean(next)
      && current.dirty === next.dirty
      && current.position[0] === next.position[0]
      && current.position[1] === next.position[1]
      && current.position[2] === next.position[2];
  });
}

function snap(value: number) {
  return Math.round(value / SNAP_STEP) * SNAP_STEP;
}

function getEditorPoint(event: { point: { x: number; z: number } }): Point2 {
  return {
    x: snap(event.point.x),
    z: snap(event.point.z),
  };
}

function setCursor(cursor: string) {
  document.body.style.cursor = cursor;
}

function stopCanvasInteraction(event: ThreeEvent<PointerEvent>) {
  event.stopPropagation();
  event.nativeEvent.preventDefault();
  event.nativeEvent.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

function DeviceMarkerLayer({
  device,
  positioning,
  selected,
  onDragEnd,
  onDragStart,
  onSelect,
}: {
  device: FloorDevice & {
    position: DevicePosition;
  };
  positioning?: boolean;
  selected?: boolean;
  onDragEnd: (event: ThreeEvent<PointerEvent>) => void;
  onDragStart: (device: FloorDevice, event: ThreeEvent<PointerEvent>) => void;
  onSelect: (device: FloorDevice) => void;
}) {
  const deviceType = DEVICE_TYPES[device.type];
  const markerColor = selected ? deviceType.color : "#ffffff";

  return (
    <group
      position={device.position}
      onClick={selected ? undefined : (event) => {
        event.stopPropagation();
        onSelect(device);
      }}
      onPointerDown={selected ? undefined : (event) => {
        stopCanvasInteraction(event);
        onDragStart(device, event);
      }}
      onPointerEnter={selected ? undefined : (event) => {
        event.stopPropagation();
        setCursor("grab");
      }}
      onPointerLeave={selected ? undefined : () => {
        setCursor("default");
      }}
      onPointerUp={selected ? undefined : onDragEnd}
    >
      <Line
        color={deviceType.color}
        lineWidth={positioning ? 4 : 2}
        points={[
          [0, 0.02, 0],
          [0, 1.15, 0],
        ]}
      />

      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.13, 0.2, 32]} />
        <meshBasicMaterial color={deviceType.color} depthTest={false} />
      </mesh>

      {!selected ? (
        <mesh position={[0, 1.16, 0]}>
          <sphereGeometry args={[0.35, 24, 16]} />
          <meshBasicMaterial color={markerColor} opacity={0.02} transparent />
        </mesh>
      ) : null}

      <Html center position={[0, 1.15, 0]} style={{ pointerEvents: "none" }}>
        <div
          className="flex size-14 items-center justify-center rounded-full border text-white shadow-[0_0_26px_rgba(94,234,212,0.35)]"
          style={{
            backgroundColor: selected ? `${deviceType.color}44` : "#111111",
            borderColor: deviceType.color,
          }}
        >
          <DeviceGlyph className="size-7" type={device.type} />
        </div>
      </Html>
    </group>
  );
}

function DeviceTransformGizmo({
  position,
  onDragChange,
  onPositionChange,
}: {
  position: DevicePosition;
  onDragChange: (dragging: boolean) => void;
  onPositionChange: (position: DevicePosition) => void;
}) {
  const transformObject = useMemo(() => new Group(), []);

  function emitPosition() {
    onPositionChange([
      snap(transformObject.position.x),
      snap(transformObject.position.y),
      snap(transformObject.position.z),
    ]);
  }

  return (
    <>
      <TransformControls
        mode="translate"
        object={transformObject}
        size={1.1}
        space="world"
        translationSnap={SNAP_STEP}
        onMouseDown={() => onDragChange(true)}
        onMouseUp={() => {
          emitPosition();
          onDragChange(false);
        }}
        onObjectChange={emitPosition}
      />
      <primitive object={transformObject} position={position} />
    </>
  );
}

function FilterButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="flex size-16 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white transition hover:border-white/30 data-[active=true]:bg-white/15"
      data-active={active}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type FloorViewerTestProps = {
  initialFloorId?: number | null;
};

export function FloorViewerTest({ initialFloorId = null }: FloorViewerTestProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setRightAction, setTitle } = useHeaderTitle();
  const floorIdFromUrl = parseFloorId(searchParams.get("floorId"));
  const requestedFloorId = floorIdFromUrl ?? initialFloorId;
  const {
    data: floors = EMPTY_FLOORS,
    isError: floorsError,
    isLoading: floorsLoading,
  } = useFloors();
  const {
    data: rooms = EMPTY_ROOMS,
    isError: roomsError,
    isLoading: roomsLoading,
  } = useRooms();
  const {
    data: realDevices = EMPTY_DEVICES,
    isError: devicesError,
    isLoading: devicesLoading,
  } = useDevices();
  const { data: entities = EMPTY_ENTITIES } = useEntities();
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
  const [devicePositions, setDevicePositions] = useState<DevicePositionState>(
    {},
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [positioningDeviceId, setPositioningDeviceId] = useState<number | null>(
    null,
  );
  const [draggingDeviceId, setDraggingDeviceId] = useState<number | null>(null);
  const gizmoDraggingRef = useRef(false);
  const editorModelRef = useRef<Group | null>(null);
  const [cameraActions, setCameraActions] = useState<CameraActions | null>(null);
  const [activeFilter, setActiveFilter] = useState<DeviceFilter>("all");
  const {
    data: floorPositionRows = EMPTY_FLOOR_POSITION_ROWS,
    isError: floorPositionsError,
    isLoading: floorPositionsLoading,
  } = useFloorDevicePositions(selectedFloorId);
  const replacePositions = useReplaceFloorDevicePositions();
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
  const floorRooms = useMemo(
    () => getFloorRooms(rooms, selectedFloorId),
    [rooms, selectedFloorId],
  );
  const devices = useMemo(
    () => buildFloorDevices(realDevices, entities, floorRooms, devicePositions),
    [devicePositions, entities, floorRooms, realDevices],
  );

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const positionedDevices = useMemo(
    () =>
      devices.filter(
        (
          device,
        ): device is FloorDevice & {
          position: DevicePosition;
        } => Boolean(device.position),
      ),
    [devices],
  );

  useEffect(() => {
    setFailedModelUrl(null);
  }, [selectedFloorModelUrl]);

  useEffect(() => {
    setTitle(
      <div className="flex items-center gap-3">
        <span className="font-semibold">
          Editor 3d - {selectedFloor?.name ?? "Piso"}
        </span>
        <Select
          disabled={!floors.length}
          value={selectedFloorId ? String(selectedFloorId) : null}
          onValueChange={(value) => {
            const floorId = Number(value);
            const nextFloorId = Number.isFinite(floorId) ? floorId : null;
            setSelectedFloorId(nextFloorId);
            if (nextFloorId) {
              router.replace(`/floor-editor?floorId=${nextFloorId}`, {
                scroll: false,
              });
            }
            setSelectedDeviceId(null);
            setPositioningDeviceId(null);
            setDraggingDeviceId(null);
          }}
        >
          <SelectTrigger
            aria-label="Selecionar piso"
            className="w-44 border border-border bg-background/80 px-3"
            size="sm"
          >
            <SelectValue placeholder="Selecionar piso">
              {selectedFloor?.name}
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
      <div className="flex items-center gap-3">
        <div className="flex rounded-full border border-border p-0.5">
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
        <span className="h-5 w-px bg-border" />
        <Undo2 className="size-5" />
        <Redo2 className="size-5 opacity-35" />
        <span className="h-5 w-px bg-border" />
        <Settings className="size-5" />
      </div>,
    );

    return () => {
      setTitle(null);
      setRightAction(null);
    };
  }, [
    cameraActions,
    floors,
    router,
    selectedFloor?.name,
    selectedFloorId,
    setRightAction,
    setTitle,
  ]);
  const filteredDevices = useMemo(
    () =>
      activeFilter === "all"
        ? devices
        : devices.filter((device) => device.type === activeFilter),
    [activeFilter, devices],
  );
  const isPositioning = Boolean(positioningDeviceId && selectedDevice);
  const isLoading =
    floorsLoading || roomsLoading || devicesLoading || floorPositionsLoading;
  const hasError =
    floorsError || roomsError || devicesError || floorPositionsError;

  useEffect(() => {
    if (!floors.length) {
      if (selectedFloorId !== null) {
        setSelectedFloorId(null);
      }
      return;
    }

    if (
      requestedFloorId &&
      floors.some((floor) => floor.id === requestedFloorId) &&
      selectedFloorId !== requestedFloorId
    ) {
      setSelectedFloorId(requestedFloorId);
      return;
    }

    if (!selectedFloorId || !floors.some((floor) => floor.id === selectedFloorId)) {
      setSelectedFloorId(floors[0].id);
    }
  }, [floors, requestedFloorId, selectedFloorId]);

  useEffect(() => {
    if (!devices.length) {
      if (selectedDeviceId !== null) setSelectedDeviceId(null);
      if (positioningDeviceId !== null) setPositioningDeviceId(null);
      if (draggingDeviceId !== null) setDraggingDeviceId(null);
      return;
    }

    if (
      selectedDeviceId === null ||
      !devices.some((device) => device.id === selectedDeviceId)
    ) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, draggingDeviceId, positioningDeviceId, selectedDeviceId]);

  useEffect(() => {
    const nextPositions = positionsFromRows(floorPositionRows);

    setDevicePositions((currentPositions) => areDevicePositionsEqual(currentPositions, nextPositions)
      ? currentPositions
      : nextPositions,
    );
  }, [floorPositionRows, selectedFloorId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPositioningDeviceId(null);
        setDraggingDeviceId(null);
        setCursor("default");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function updateDevicePosition(deviceId: number, point: Point2) {
    updateDevicePosition3D(deviceId, [point.x, DEVICE_Y, point.z]);
  }

  function updateDevicePosition3D(deviceId: number, position: DevicePosition) {
    setDevicePositions((currentPositions) => ({
      ...currentPositions,
      [deviceId]: {
        dirty: true,
        position,
      },
    }));
  }

  function startPositioning(device: FloorDevice) {
    setDevicePositions((currentPositions) => ({
      ...currentPositions,
      [device.id]: currentPositions[device.id] ?? {
        dirty: true,
        position: DEFAULT_DEVICE_POSITION,
      },
    }));
    setSelectedDeviceId(device.id);
    setPositioningDeviceId(device.id);
  }

  function handleEditorPointerMove(event: ThreeEvent<PointerEvent>) {
    if (!draggingDeviceId || gizmoDraggingRef.current) {
      return;
    }

    event.stopPropagation();
    updateDevicePosition(draggingDeviceId, getEditorPoint(event));
  }

  function handleEditorPointerUp(event: ThreeEvent<PointerEvent>) {
    if (!draggingDeviceId || gizmoDraggingRef.current) {
      return;
    }

    event.stopPropagation();
    setDraggingDeviceId(null);
    setCursor("default");
  }

  function handleMarkerDragStart(
    device: FloorDevice,
    _event: ThreeEvent<PointerEvent>,
  ) {
    setSelectedDeviceId(device.id);
    setPositioningDeviceId(device.id);
    setDraggingDeviceId(device.id);
    setCursor("grabbing");
  }

  function removeSelectedDeviceFromScene() {
    if (!selectedDevice) {
      return;
    }

    setDevicePositions((currentPositions) => {
      const nextPositions = { ...currentPositions };
      delete nextPositions[selectedDevice.id];
      return nextPositions;
    });
    setPositioningDeviceId(null);
  }

  function saveMock() {
    if (!selectedFloorId) {
      return;
    }

    replacePositions.mutate(
      {
        floorId: selectedFloorId,
        positions: positionedDevices.map((device) => ({
          deviceId: device.deviceId,
          entityId: device.entityId,
          x: device.position[0],
          y: device.position[1],
          z: device.position[2],
        })),
      },
      {
        onSuccess: (savedPositions) => {
          setDevicePositions(positionsFromRows(savedPositions));
        },
      },
    );
    setPositioningDeviceId(null);
  }

  function resetMock() {
    setDevicePositions(positionsFromRows(floorPositionRows));
    setSelectedDeviceId(devices[0]?.id ?? null);
    setPositioningDeviceId(null);
    setDraggingDeviceId(null);
    setCursor("default");
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] flex-col overflow-hidden rounded-2xl bg-[#050505] text-white">
      <div className="grid min-h-0 flex-1 gap-5 p-5 pb-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[520px] overflow-hidden rounded-3xl border border-white/10 bg-black">
          <div className="absolute left-7 top-7 z-10 flex gap-5">
            <FilterButton
              active={activeFilter === "light"}
              label="Filtrar lâmpadas"
              onClick={() => setActiveFilter("light")}
            >
              <Lightbulb className="size-7" />
            </FilterButton>
            <FilterButton
              active={activeFilter === "climate"}
              label="Filtrar climatização"
              onClick={() => setActiveFilter("climate")}
            >
              <AirVent className="size-7" />
            </FilterButton>
            <FilterButton
              active={activeFilter === "cover"}
              label="Filtrar cortinas"
              onClick={() => setActiveFilter("cover")}
            >
              <Blinds className="size-7" />
            </FilterButton>
            <FilterButton
              active={activeFilter === "all"}
              label="Mostrar todos"
              onClick={() => setActiveFilter("all")}
            >
              <Grid2X2 className="size-7" />
            </FilterButton>
          </div>

          {isPositioning && selectedDevice ? (
            <div className="absolute left-1/2 top-5 z-10 flex w-[min(620px,calc(100%-48px))] -translate-x-1/2 items-center justify-between rounded-2xl border border-teal-300 bg-black/80 px-7 py-4 shadow-lg backdrop-blur">
              <div className="flex items-center gap-5">
                <Move3D className="size-8 text-teal-300" />
                <div>
                  <p className="text-base font-semibold">
                    Posicionando:{" "}
                    <span className="text-teal-300">{selectedDevice.name}</span>
                  </p>
                  <p className="text-sm text-white/45">
                    Arraste o marcador ou use o eixo Y
                  </p>
                </div>
              </div>
              <button
                className="flex items-center gap-4 text-sm font-semibold"
                type="button"
                onClick={() => {
                  setPositioningDeviceId(null);
                }}
              >
                Cancelar
                <span className="rounded-md bg-white/10 px-2 py-1 text-xs text-white/40">
                  ESC
                </span>
              </button>
            </div>
          ) : null}

          <Canvas camera={{ position: [28, 16, 16], fov: 42 }}>
            <ambientLight intensity={0.9} />
            <directionalLight position={[6, 12, 7]} intensity={1.4} />

            <Suspense fallback={null}>
              {availableModelUrl ? (
                <group ref={editorModelRef}>
                  <Bounds fit clip margin={1.1}>
                    <FloorModelErrorBoundary
                      resetKey={availableModelUrl}
                      onError={() => setFailedModelUrl(availableModelUrl)}
                    >
                      <FloorModel url={availableModelUrl} />
                    </FloorModelErrorBoundary>
                  </Bounds>
                </group>
              ) : null}

              <Environment preset="apartment" />
            </Suspense>

            <Grid
              args={[GRID_SIZE, GRID_SIZE]}
              cellColor="#1f2937"
              cellSize={1}
              cellThickness={0.45}
              fadeDistance={36}
              position={[EDITOR_CENTER.x, EDITOR_Y, EDITOR_CENTER.z]}
              sectionColor="#334155"
              sectionSize={5}
              sectionThickness={0.8}
            />

            <mesh
              position={[EDITOR_CENTER.x, EDITOR_Y, EDITOR_CENTER.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onPointerMove={handleEditorPointerMove}
              onPointerUp={handleEditorPointerUp}
            >
              <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
              <meshBasicMaterial
                color="#ffffff"
                opacity={0.015}
                side={DoubleSide}
                transparent
              />
            </mesh>

            {positionedDevices.map((device) => (
              <DeviceMarkerLayer
                key={device.id}
                device={device}
                positioning={positioningDeviceId === device.id}
                selected={selectedDeviceId === device.id}
                onDragEnd={handleEditorPointerUp}
                onDragStart={handleMarkerDragStart}
                onSelect={(selectedMarker) => {
                  setSelectedDeviceId(selectedMarker.id);
                }}
              />
            ))}

            {selectedDevice?.position ? (
              <DeviceTransformGizmo
                position={selectedDevice.position}
                onDragChange={(dragging) => {
                  gizmoDraggingRef.current = dragging;
                  setDraggingDeviceId(dragging ? selectedDevice.id : null);
                  setCursor(dragging ? "grabbing" : "default");
                }}
                onPositionChange={(position) => {
                  updateDevicePosition3D(selectedDevice.id, position);
                }}
              />
            ) : null}

            <CameraViewControls
              enabled={!draggingDeviceId}
              modelRef={editorModelRef}
              onReady={setCameraActions}
            />
          </Canvas>

          <div className="absolute bottom-20 left-8 z-10 text-xs text-white/45">
            <div className="relative size-24">
              <span className="absolute bottom-8 left-8 size-3 rounded-full bg-white" />
              <span className="absolute bottom-14 left-8 h-10 w-0.5 bg-teal-300" />
              <span className="absolute bottom-24 left-6 text-teal-300">Y</span>
              <span className="absolute bottom-7 left-11 h-0.5 w-11 rotate-[28deg] bg-red-400" />
              <span className="absolute bottom-3 left-20 text-red-400">X</span>
              <span className="absolute bottom-7 right-16 h-0.5 w-10 -rotate-[28deg] bg-sky-400" />
              <span className="absolute bottom-3 left-0 text-sky-400">Z</span>
            </div>
          </div>

          <p className="absolute bottom-7 left-7 z-10 text-sm text-white/35">
            Arraste a cena para girar. Use o eixo Y para ajustar a altura.
          </p>
        </div>

        <aside className="flex min-h-0 flex-col gap-5">
          <section className="rounded-2xl border border-white/10 bg-black p-6">
            <h2 className="mb-8 text-lg font-semibold">Seleção</h2>

            {selectedDevice ? (
              <div className="space-y-7">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <DeviceGlyph
                      className="size-7"
                      type={selectedDevice.type}
                    />
                    <div>
                      <p className="font-medium">{selectedDevice.name}</p>
                      <p className="text-sm text-white/30">
                        {selectedDevice.room} -{" "}
                        {DEVICE_TYPES[selectedDevice.type].label}
                      </p>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-medium"
                    data-dirty={selectedDevice.dirty}
                    data-positioned={Boolean(selectedDevice.position)}
                    style={{
                      backgroundColor: selectedDevice.dirty
                        ? "rgb(250 204 21 / 0.2)"
                        : selectedDevice.position
                          ? "rgb(45 212 191 / 0.16)"
                          : "rgb(255 255 255 / 0.08)",
                      color: selectedDevice.dirty
                        ? "rgb(253 224 71)"
                        : selectedDevice.position
                          ? "rgb(94 234 212)"
                          : "rgb(255 255 255 / 0.45)",
                    }}
                  >
                    {selectedDevice.dirty
                      ? "Pendente"
                      : selectedDevice.position
                        ? "Salvo"
                        : "Fora"}
                  </span>
                </div>

                <div>
                  <p className="text-base font-medium text-white/30">Posição</p>
                  <p className="text-sm text-white/35">
                    {selectedDevice.position
                      ? `x ${selectedDevice.position[0].toFixed(1)} | z ${selectedDevice.position[2].toFixed(1)} | y ${selectedDevice.position[1].toFixed(1)}`
                      : "Fora da cena"}
                  </p>
                </div>

                <div className="flex gap-3 pt-8">
                  <Button
                    className="flex-1 bg-red-950 text-red-300 hover:bg-red-900"
                    disabled={!selectedDevice.position}
                    onClick={removeSelectedDeviceFromScene}
                  >
                    <Trash2 />
                    Remover
                  </Button>
                  <Button
                    aria-label="Resetar"
                    size="icon"
                    variant="outline"
                    onClick={resetMock}
                  >
                    <RotateCcw />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/35">Nada selecionado</p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-black p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Dispositivos</h2>
              <span className="text-xs text-white/35">
                {positionedDevices.length}/{devices.length} na cena
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {isLoading ? (
                <p className="rounded-2xl border border-white/10 p-4 text-sm text-white/35">
                  Carregando pisos e dispositivos...
                </p>
              ) : null}

              {hasError ? (
                <p className="rounded-2xl border border-red-400/20 p-4 text-sm text-red-300">
                  Erro ao carregar dados reais.
                </p>
              ) : null}

              {!isLoading && !hasError && !floors.length ? (
                <p className="rounded-2xl border border-white/10 p-4 text-sm text-white/35">
                  Nenhum piso cadastrado.
                </p>
              ) : null}

              {!isLoading && !hasError && floors.length > 0 && !devices.length ? (
                <p className="rounded-2xl border border-white/10 p-4 text-sm text-white/35">
                  Nenhum dispositivo neste piso.
                </p>
              ) : null}

              {!isLoading &&
              !hasError &&
              devices.length > 0 &&
              !filteredDevices.length ? (
                <p className="rounded-2xl border border-white/10 p-4 text-sm text-white/35">
                  Nenhum dispositivo neste filtro.
                </p>
              ) : null}

              {filteredDevices.map((device) => {
                const isSelected = selectedDeviceId === device.id;
                const hasPosition = Boolean(device.position);

                return (
                  <button
                    key={device.id}
                    className="flex w-full items-center gap-4 rounded-3xl px-4 py-3 text-left transition hover:bg-white/10 data-[selected=true]:bg-white/15"
                    data-selected={isSelected}
                    type="button"
                    onClick={() => {
                      if (hasPosition) {
                        setSelectedDeviceId(device.id);
                        return;
                      }

                      startPositioning(device);
                    }}
                  >
                    <DeviceGlyph className="size-7" type={device.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-white/30">
                        {device.room}
                      </span>
                      <span className="block truncate text-base">
                        {device.name}
                      </span>
                    </span>
                    {hasPosition ? (
                      <Check className="size-4 text-teal-300" />
                    ) : (
                      <ListPlus className="size-4 text-white/45" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      <footer className="flex h-20 shrink-0 justify-end gap-4 px-5 pb-5">
        <Button
          className="h-12 rounded-full border-white/15 px-8 text-base"
          variant="outline"
          onClick={resetMock}
        >
          <X />
          Cancelar
        </Button>
        <Button
          className="h-12 rounded-full px-8 text-base"
          disabled={!selectedFloorId || replacePositions.isPending}
          onClick={saveMock}
        >
          <Save />
          {replacePositions.isPending ? "Salvando" : "Salvar"}
        </Button>
      </footer>
    </section>
  );
}
