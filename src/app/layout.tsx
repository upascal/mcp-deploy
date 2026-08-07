import type { Metadata } from "next";
import Link from "next/link";
import { ThemeProvider } from "@/components/ThemeProvider";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Deploy",
  description: "Deploy and manage MCP servers on Cloudflare Workers",
};

const themeScript = `
(function(){
  var t = localStorage.getItem("mcp-deploy-theme");
  if (t === "light" || t === "system") {
    document.documentElement.setAttribute("data-theme", t);
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {process.env.NODE_ENV === "development" && (
          <script src="http://localhost:9898/overlay.js?project=mcp-deploy" defer />
        )}
      </head>
      <body className="bg-surface-page text-fg min-h-screen antialiased">
        <ThemeProvider>
          <nav className="border-b border-edge bg-surface/50 backdrop-blur-sm fixed top-0 inset-x-0 z-50">
            <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                <span className="text-accent-fg">MCP</span> Deploy
              </Link>
              <NavLinks />
            </div>
          </nav>
          <main className="max-w-5xl mx-auto px-6 py-8 pt-16">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
