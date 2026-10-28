import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";

export const metadata: Metadata = {
  title: "Cloud Plan · 让计划清晰",
  description: "每日清单与长期任务四象限，让每一步都有方向。",
  robots: { index: false, follow: false },
  applicationName: "Cloud Plan",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cloud Plan", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.svg?v=2", type: "image/svg+xml" },
      { url: "/icons/cloud-plan-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon.ico?v=2", sizes: "16x16 32x32 48x48 256x256" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: { url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = { themeColor: "#2167b5" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
