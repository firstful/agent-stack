/**
 * Mobile web layout (mdot route).
 *
 * Single-column layout optimised for mobile browsers with reduced info density,
 * larger touch targets, and a bottom tab navigation bar.
 *
 * Route: /m/*
 */
import type { Metadata, Viewport } from "next";
import "../../globals.css";
import { AuthProvider } from "@/lib/auth";
import { MobileNav } from "./MobileNav";
import "./mobile.css";

export const metadata: Metadata = {
  title: "Groupthink Mobile",
  description: "Groupthink — mobile web",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0d1117",
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="mdot-body">
        <AuthProvider>
          <div className="mdot-shell">
            <main className="mdot-content">{children}</main>
            <MobileNav />
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
