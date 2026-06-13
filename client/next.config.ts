import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "path";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: [
    '192.168.1.28',
    'MacBook-Pro-de-Victor.local',
    '23b5-2804-30c-1812-3e00-a175-d4bd-449-f9f3.ngrok-free.app',
  ],
};

export default nextConfig;
