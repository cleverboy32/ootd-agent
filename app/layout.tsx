import type { Metadata } from "next";
import { AccessProvider } from "@/components/access/AccessProvider";
import { AuthBootOverlay } from "@/components/auth/AuthBootOverlay";
import { AuthModalProvider } from "@/components/auth/AuthModalProvider";
import { SavedOutfitsBootstrap } from "@/components/collect/SavedOutfitsBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fashion AI - 你的专属时尚搭配助手",
  description: "上传衣服照片，获取专业的搭配建议和方案",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // System stacks — avoids Google Fonts fetch during build on offline hosts.
  const fontStyle = {
    ['--font-geist-sans' as string]: 'ui-sans-serif, system-ui, sans-serif',
    ['--font-geist-mono' as string]: 'ui-monospace, monospace',
  };

  return (
    <html
      lang="en"
      className="h-full antialiased"
      style={fontStyle}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AccessProvider>
          <AuthBootOverlay />
          <AuthModalProvider>
            <SavedOutfitsBootstrap />
            {children}
          </AuthModalProvider>
        </AccessProvider>
      </body>
    </html>
  );
}
