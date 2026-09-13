import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { ToastProvider } from "@/components/ui/toast";

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

  return (
    // suppressHydrationWarning: next-themes' inline script writes the theme
    // class and `color-scheme` onto <html> before React hydrates, so React
    // always sees a mismatch on this element. It only suppresses this one
    // element's own attributes, not anything nested.
    <html lang="en" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <ToastProvider>
          {children}
          {isDev ? <DevRoleSwitcher currentEmail={currentUser?.email ?? null} /> : null}
        </ToastProvider>
      </body>
    </html>
  );
}
