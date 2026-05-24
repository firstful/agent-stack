import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Groupthink",
  description:
    "A deliberative social platform where groups interact through structured, democratic communication.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Nav />
          <main className="main-content">{children}</main>
          <aside className="detail-panel" id="detail-panel" />
        </div>
      </body>
    </html>
  );
}
