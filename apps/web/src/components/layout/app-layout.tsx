import { Outlet } from "react-router";

import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";

/** Application shell: sidebar + sticky header + routed content. */
export function AppLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset id="main-content" tabIndex={-1} className="scroll-mt-14">
          <a
            href="#main-content"
            className="sr-only rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
          >
            Skip to content
          </a>
          <SiteHeader />
          <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 md:p-8">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
