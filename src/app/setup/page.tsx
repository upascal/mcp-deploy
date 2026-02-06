import { CloudflareSetup } from "@/components/CloudflareSetup";

export default function SetupPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-gray-400 text-sm">
          Configure your Cloudflare account for MCP deployments.
        </p>
      </div>
      <CloudflareSetup />
    </div>
  );
}
