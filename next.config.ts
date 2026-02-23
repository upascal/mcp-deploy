import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["cloudflare", "better-sqlite3"],
};

export default nextConfig;
