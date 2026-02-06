import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cloudflare", "better-sqlite3"],
};

export default nextConfig;
