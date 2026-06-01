import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "path";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: ['0cff-2804-30c-1812-3e00-4827-f186-92ee-1370.ngrok-free.app'],
};

export default nextConfig;
