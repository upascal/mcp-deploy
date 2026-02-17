import { CloudflareSetup } from "@/components/CloudflareSetup";
import { ThemeToggle } from "@/components/ThemeToggle";
import pkg from "../../../package.json";

export default function SetupPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-fg-muted text-sm">
          Configure your Cloudflare account and app preferences.
        </p>
      </div>

      <CloudflareSetup />

      {/* Appearance */}
      <section className="rounded-xl border border-edge bg-surface p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Appearance</h2>
          <p className="text-fg-muted text-sm mt-1">
            Choose a color theme for the dashboard.
          </p>
        </div>
        <ThemeToggle />
      </section>

      {/* About */}
      <section className="rounded-xl border border-edge bg-surface p-6 space-y-4">
        <h2 className="text-lg font-semibold">About</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-fg-muted">Name</dt>
          <dd>{pkg.name}</dd>

          <dt className="text-fg-muted">Version</dt>
          <dd>{pkg.version}</dd>

          <dt className="text-fg-muted">Description</dt>
          <dd>{pkg.description}</dd>

          <dt className="text-fg-muted">License</dt>
          <dd>{pkg.license}</dd>

          <dt className="text-fg-muted">Source</dt>
          <dd>
            <a
              href={pkg.repository.url.replace(/\.git$/, "")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-fg hover:underline"
            >
              {pkg.repository.url.replace(/\.git$/, "").replace("https://", "")}
            </a>
          </dd>
        </dl>
      </section>
    </div>
  );
}
