"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { House, ListIcon, PlaySquare, Sofa, Workflow } from "lucide-react"

import { cn } from "@/lib/utils"

const items = [
  { title: "Casa", url: "/", icon: House },
  { title: "Devices", url: "/devices", icon: ListIcon },
  { title: "Ambientes", url: "/rooms", icon: Sofa },
  { title: "Cenas", url: "/scenes", icon: PlaySquare },
  { title: "Automações", url: "/automations", icon: Workflow },
]

export function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md md:hidden">
      <div className="grid grid-cols-5">
        {items.map((item) => {
          const active = pathname === item.url || (item.url !== "/" && pathname.startsWith(`${item.url}/`))
          const Icon = item.icon

          return (
            <Link
              key={item.url}
              href={item.url}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] text-muted-foreground",
                active && "bg-secondary text-foreground",
              )}
            >
              <Icon className="size-5" />
              <span className="max-w-full truncate">{item.title}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
