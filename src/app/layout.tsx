import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CaféOps",
  description: "Café point-of-sale, inventory, and profit management",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Dev-only convenience widget (one-click account switching); never
  // queried, and never rendered, in production — see
  // src/components/dev-role-switcher.tsx for the second, independent
  // guard on the server action it calls.
  const isDev = process.env.NODE_ENV !== "production";
  const currentUser = isDev ? await getCurrentUser() : null;
  // Set by src/proxy.ts for the Content-Security-Policy; next-themes' inline
  // script must carry it or the browser blocks it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // suppressHydrationWarning: next-themes' inline script writes the theme
    // class and `color-scheme` onto <html> before React hydrates, so React
    // always sees a mismatch on this element. It only suppresses this one
    // element's own attributes, not anything nested.
    <html lang="en" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/*
          next-themes lives at the root, not inside AdminShell.
          ThemeProvider renders an inline <script> to set the theme class
          before first paint; React logs "Encountered a script tag while
          rendering React component" if that script is ever produced by a
          client re-render, which is exactly what happened when a Server
          Action revalidated the dashboard layout (saving branding,
          switching business). At the root it renders once with the
          document and is never re-rendered by a nested revalidation.

          Dark mode stays admin-only, as the PRD requires: /pos and /login
          carry `.force-light-theme`, which re-pins the light tokens and
          `color-scheme` regardless of what next-themes puts on <html>.
        */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          <ToastProvider>
            {children}
            {isDev ? <DevRoleSwitcher currentEmail={currentUser?.email ?? null} /> : null}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
