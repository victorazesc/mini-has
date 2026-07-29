"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { HeaderTitleProvider } from "@/src/providers/header-title-provider";

const PUBLIC_PATHS = ["/login", "/oauth/authorize"];

export function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (isPublicPath) {
    return <main className="flex min-h-screen w-full items-center justify-center p-4">{children}</main>;
  }

  return (
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
  );
}
