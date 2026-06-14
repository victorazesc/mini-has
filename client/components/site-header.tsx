"use client"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { data } from "@/components/app-sidebar"
import { usePathname } from "next/navigation"
import { useHeaderTitle } from "@/src/providers/header-title-provider"

export function SiteHeader() {
  const pathname = usePathname()
  const { title, rightAction } = useHeaderTitle()
  const fallbackTitle = data.navMain.find((item) => item.url === pathname)?.title

  return (
    <header className="sticky top-0 z-40 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/90 backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex min-w-0 w-full items-center justify-between gap-2 px-3 sm:px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-1 lg:gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 hidden h-4 data-vertical:self-auto sm:block"
          />
          <h1 className="min-w-0 truncate text-sm font-medium sm:text-base">{title ?? fallbackTitle}</h1>
        </div>
        <div className="shrink-0">{rightAction}</div>
      </div>
    </header>
  )
}
