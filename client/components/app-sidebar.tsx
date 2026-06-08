"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import {
  Sidebar,
  SidebarContent,
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
  PlaySquareIcon,
  SlidersHorizontalIcon,
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
  ],
  navSecondary: [
    {
      title: "Configurações",
      url: "#",
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
    </Sidebar>
  )
}
