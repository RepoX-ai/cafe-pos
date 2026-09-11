import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {isDev ? <DevRoleSwitcher currentEmail={currentUser?.email ?? null} /> : null}
      </body>
    </html>
  );
}
