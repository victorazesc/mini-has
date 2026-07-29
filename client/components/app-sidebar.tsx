"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  BathIcon,
  CircleHelpIcon,
  CloudIcon,
  HomeIcon,
  HouseWifiIcon,
  ListIcon,
  LogOutIcon,
  PlaySquareIcon,
  SlidersHorizontalIcon,
  SunIcon,
  WorkflowIcon,
} from "lucide-react"

export const data = {
  navMain: [
    {
      title: "Visão espacial",
      url: "/",
      icon: <HomeIcon />,
    },
    {
      title: "Dispositivos",
      url: "/devices",
      icon: <ListIcon />,
    },
    {
      title: "Ambientes",
      url: "/rooms",
      icon: <BathIcon />,
    },
    {
      title: "Integrações",
      url: "/integrations",
      icon: <CloudIcon />,
    },
    {
      title: "Cenas",
      url: "/scenes",
      icon: <PlaySquareIcon />,
    },
    {
      title: "Automações",
      url: "/automations",
      icon: <WorkflowIcon />,
    },
    {
      title: "Solar",
      url: "/solar",
      icon: <SunIcon />,
    },
  ],
  navSecondary: [
    {
      title: "Configurações",
      url: "/settings",
      icon: <SlidersHorizontalIcon />,
    },
    {
      title: "Ajuda",
      url: "#",
      icon: <CircleHelpIcon />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null)
    window.location.assign("/login")
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="px-4 py-5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-9 gap-2 px-0 text-lg font-semibold hover:bg-transparent data-[active=true]:bg-transparent [&_svg]:size-5"
              render={<a href="#" />}
            >
              <HouseWifiIcon />
              <span>Azevedo</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-4 pb-6 pt-16">
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout}>
              <LogOutIcon />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
