"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type CameraActions = {
  topView: () => void;
  defaultView: () => void;
  focusDevice: (position: [number, number, number]) => void;
};

type CameraViewControlsProps = {
  enabled?: boolean;
  focusScale?: number;
  modelRef: React.RefObject<THREE.Group | null>;
  onReady?: (actions: CameraActions) => void;
  viewScale?: number;
};

export function CameraViewControls({
  enabled = true,
  focusScale = 1,
  modelRef,
  onReady,
  viewScale = 1,
}: CameraViewControlsProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  const targetPositionRef = useRef(new THREE.Vector3());
  const targetLookAtRef = useRef(new THREE.Vector3());
  const targetUpRef = useRef(camera.up.clone());
  const isAnimatingRef = useRef(false);

  const getModelBox = useCallback(() => {
    const box = new THREE.Box3();

    if (!modelRef.current) {
      return {
        center: new THREE.Vector3(0, 0, 0),
        size: new THREE.Vector3(20, 10, 20),
      };
    }

    box.setFromObject(modelRef.current);

    if (box.isEmpty()) {
      return {
        center: new THREE.Vector3(0, 0, 0),
        size: new THREE.Vector3(20, 10, 20),
      };
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();

    box.getCenter(center);
    box.getSize(size);

    return { center, size };
  }, [modelRef]);

  const moveCameraTo = useCallback((
    position: THREE.Vector3,
    lookAt: THREE.Vector3,
    up = new THREE.Vector3(0, 1, 0),
  ) => {
    targetPositionRef.current.copy(position);
    targetLookAtRef.current.copy(lookAt);
    targetUpRef.current.copy(up);
    isAnimatingRef.current = true;

    if (controlsRef.current) {
      controlsRef.current.enableDamping = false;
      controlsRef.current.update();
      controlsRef.current.enabled = false;
    }
  }, []);

  const topView = useCallback(() => {
    const { center, size } = getModelBox();
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const verticalFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * perspectiveCamera.aspect);
    const distance = Math.max(
      size.z / (2 * Math.tan(verticalFov / 2)),
      size.x / (2 * Math.tan(horizontalFov / 2)),
    ) * 2.05 * viewScale;

    moveCameraTo(
      new THREE.Vector3(
        center.x,
        center.y + Math.max(distance, 12 * viewScale),
        center.z + distance * 0.001,
      ),
      center,
      new THREE.Vector3(0, 0, -1),
    );
  }, [camera, getModelBox, moveCameraTo, viewScale]);

  const defaultView = useCallback(() => {
    const { center, size } = getModelBox();
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const verticalFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const effectiveFov = Math.min(
      verticalFov,
      2 * Math.atan(Math.tan(verticalFov / 2) * perspectiveCamera.aspect),
    );
    const radius = size.length() / 2;
    const distance = Math.max(
      radius / Math.sin(effectiveFov / 2) * 1.55 * viewScale,
      18 * viewScale,
    );
    const direction = new THREE.Vector3(0.65, 0.55, 1).normalize();

    moveCameraTo(
      center.clone().addScaledVector(direction, distance),
      center,
      new THREE.Vector3(0, 1, 0),
    );
  }, [camera, getModelBox, moveCameraTo, viewScale]);

  const focusDevice = useCallback((position: [number, number, number]) => {
    const { center, size } = getModelBox();
    const maxSize = Math.max(size.x, size.z);
    const deviceCenter = new THREE.Vector3(
      position[0],
      position[1] || center.y,
      position[2],
    );
    const height = THREE.MathUtils.clamp(maxSize * 0.65, 18, 25) * focusScale;

    moveCameraTo(
      new THREE.Vector3(
        deviceCenter.x,
        deviceCenter.y + height,
        deviceCenter.z + height * 0.001,
      ),
      deviceCenter,
      new THREE.Vector3(0, 0, -1),
    );
  }, [focusScale, getModelBox, moveCameraTo]);

  useFrame(() => {
    if (!isAnimatingRef.current) return;

    camera.position.lerp(targetPositionRef.current, 0.08);
    camera.up.lerp(targetUpRef.current, 0.08).normalize();

    controlsRef.current?.target.lerp(targetLookAtRef.current, 0.08);

    camera.lookAt(controlsRef.current?.target ?? targetLookAtRef.current);
    camera.updateMatrixWorld();

    const distanceToPosition = camera.position.distanceTo(targetPositionRef.current);
    const distanceToTarget =
      controlsRef.current?.target.distanceTo(targetLookAtRef.current) ?? 0;

    if (distanceToPosition < 0.05 && distanceToTarget < 0.05) {
      camera.position.copy(targetPositionRef.current);
      camera.up.copy(targetUpRef.current);
      controlsRef.current?.target.copy(targetLookAtRef.current);

      camera.lookAt(targetLookAtRef.current);
      camera.updateMatrixWorld();

      isAnimatingRef.current = false;
      if (controlsRef.current) {
        controlsRef.current.update();
        controlsRef.current.enableDamping = true;
        controlsRef.current.enabled = enabled;
      }
    }
  });

  const actions = useMemo(
    () => ({
      topView,
      defaultView,
      focusDevice,
    }),
    [defaultView, focusDevice, topView],
  );

  useEffect(() => {
    onReady?.(actions);
  }, [onReady, actions]);

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={enabled}
      enableDamping
      enablePan
      enableRotate
      enableZoom
      makeDefault
      maxPolarAngle={Math.PI / 2.15}
    />
  );
}
