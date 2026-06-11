import { basename, join, resolve } from "node:path";

import { env } from "node:process";

export function getFloorModelUploadDir() {
    return env.FLOOR_MODEL_UPLOAD_DIR
        ? resolve(env.FLOOR_MODEL_UPLOAD_DIR)
        : join(process.cwd(), "public", "uploads", "floors");
}

export function getSafeFloorModelPath(fileName: string) {
    if (basename(fileName) !== fileName || !/^[a-z0-9][a-z0-9.-]*\.glb$/i.test(fileName)) {
        return null;
    }

    return join(getFloorModelUploadDir(), fileName);
}
