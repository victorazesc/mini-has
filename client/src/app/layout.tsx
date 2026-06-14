import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/src/providers/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { ReactQueryProvider } from "../providers/react-query";
import { HeaderTitleProvider } from "@/src/providers/header-title-provider";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

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
            <SidebarProvider
              style={
                {
                  "--sidebar-width": "calc(var(--spacing) * 72)",
                  "--header-height": "calc(var(--spacing) * 12)",
                } as React.CSSProperties
              }
            >
              <AppSidebar variant="inset" />
              <SidebarInset>
                <HeaderTitleProvider>
                  <SiteHeader />
                  <div className="flex flex-1 flex-col">
                    <div className="@container/main flex flex-1 flex-col gap-2">
                      <div className="flex flex-col gap-4 py-3 pb-24 md:gap-6 md:py-6">
                        {children}
                      </div>
                    </div>
                  </div>
                </HeaderTitleProvider>
              </SidebarInset>
              <MobileBottomNav />
            </SidebarProvider>
          </ThemeProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
