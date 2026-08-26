"use client";

import * as React from "react";
import { ChevronsUpDown, Plus } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Workspace = {
  name: string;
  plan: string;
};

const workspaces: Workspace[] = [
  { name: "Nova Web Studio", plan: "Pro" },
  { name: "Irfan Digital", plan: "Free" },
];

export function WorkspaceSwitcher() {
  const [activeWorkspace, setActiveWorkspace] = React.useState<Workspace>(
    () => workspaces[0]
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-7 rounded-md">
                <AvatarFallback
                  className="rounded-md bg-primary font-semibold text-primary-foreground"
                  aria-hidden
                >
                  NW
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">
                  {activeWorkspace.name}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {activeWorkspace.plan} plan
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.name}
                onSelect={() => setActiveWorkspace(workspace)}
                className="gap-2"
              >
                <Avatar className="size-6 rounded-md" aria-hidden>
                  <AvatarFallback className="rounded-md bg-muted text-[0.65rem] font-medium uppercase">
                    {workspace.name.slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col leading-tight">
                  <span className="font-medium">{workspace.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {workspace.plan} plan
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Plus />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
