import { Bot } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/**
 * Single-user brand block in the sidebar header. Same footprint the old demo
 * workspace switcher had — logo, name, one line of context.
 */
export function BrandMark() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-4" aria-hidden />
          </span>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate font-semibold">Freelancer Agent</span>
            <span className="truncate text-xs text-sidebar-foreground/70">
              Personal workspace
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
