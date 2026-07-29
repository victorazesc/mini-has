import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/src/providers/theme-provider";
import { ReactQueryProvider } from "../providers/react-query";
import { AuthenticatedShell } from "@/components/authenticated-shell";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mini HAS",
  description: "Controle local da sua casa inteligente",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mini HAS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171717",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <ReactQueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthenticatedShell>{children}</AuthenticatedShell>
          </ThemeProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
