import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ResponsiveLayout from "@/components/ResponsiveLayout";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PitWall - F1 Fantasy",
  description: "F1 Fantasy simulation, optimization, and analysis tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ background: "var(--background)", color: "var(--foreground)" }}
        suppressHydrationWarning
      >
        <ResponsiveLayout>{children}</ResponsiveLayout>
      </body>
    </html>
  );
}
