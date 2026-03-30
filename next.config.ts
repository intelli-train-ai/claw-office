import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'discord.js', '@discordjs/ws', 'zlib-sync'],
  allowedDevOrigins: [
    '**.ts.net',             // all Tailscale hostnames
    '192.168.3.21',          // LAN IP
    '100.92.96.30',          // Tailscale IP
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
