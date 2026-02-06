import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Deploy",
  description: "Deploy and manage MCP servers on Cloudflare Workers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <a href="/" className="text-lg font-semibold tracking-tight">
              <span className="text-blue-400">MCP</span> Deploy
            </a>
            <div className="flex gap-6 text-sm">
              <a href="/" className="text-gray-400 hover:text-gray-100 transition-colors">
                Dashboard
              </a>
              <a href="/setup" className="text-gray-400 hover:text-gray-100 transition-colors">
                Settings
              </a>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
