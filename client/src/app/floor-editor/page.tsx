import { FloorViewerTest } from "@/components/3d/floor-viewer-test";
import { Suspense } from "react";

type FloorEditorPageProps = {
  searchParams?: Promise<{
    floorId?: string | string[];
  }>;
};

function getInitialFloorId(floorId?: string | string[]) {
  const rawFloorId = Array.isArray(floorId) ? floorId[0] : floorId;
  const parsedFloorId = Number(rawFloorId);

  return Number.isFinite(parsedFloorId) ? parsedFloorId : null;
}

export default async function FloorEditorPage({
  searchParams,
}: FloorEditorPageProps) {
  const params = await searchParams;
  const initialFloorId = getInitialFloorId(params?.floorId);

  return (
    <main className="min-h-screen bg-black p-2">
      <Suspense fallback={null}>
        <FloorViewerTest initialFloorId={initialFloorId} />
      </Suspense>
    </main>
  );
}
