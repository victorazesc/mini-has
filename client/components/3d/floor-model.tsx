"use client";

import { useGLTF } from "@react-three/drei";
import { Component, useEffect } from "react";
import type { ReactNode } from "react";

type FloorModelErrorBoundaryProps = {
  children: ReactNode;
  onError?: () => void;
  resetKey: string | null;
};

type FloorModelErrorBoundaryState = {
  hasError: boolean;
};

export class FloorModelErrorBoundary extends Component<
  FloorModelErrorBoundaryProps,
  FloorModelErrorBoundaryState
> {
  state: FloorModelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): FloorModelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  componentDidUpdate(previousProps: FloorModelErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function FloorModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    scene.traverse((object) => {
      object.raycast = () => null;
    });
  }, [scene]);

  return <primitive object={scene} />;
}