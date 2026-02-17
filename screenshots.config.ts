import type { ScreenshotConfig } from "app-screenshots";

const config: ScreenshotConfig = {
  baseUrl: "http://localhost:3002",
  outputDir: "docs/screenshots",
  viewport: { width: 1280, height: 720 },
  server: {
    buildCommand: "npm run build",
    command: "npx next start -p 3002",
  },
  pages: [
    { url: "/", name: "dashboard" },
    { url: "/mcps/paper-search-mcp", name: "mcp-detail", fullPage: true },
    { url: "/setup", name: "setup", fullPage: true },
    {
      url: "/mcps/paper-search-mcp",
      name: "mcp-detail-light",
      theme: "light",
      fullPage: true,
    },
  ],
};

export default config;
