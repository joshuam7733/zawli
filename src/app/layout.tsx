import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — Restaurant operations`, template: `%s · ${BRAND.name}` },
  description: "QR ordering, kitchen display and restaurant operations for restaurants, cafés and bars.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f2b1f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
