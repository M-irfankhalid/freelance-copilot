import { Link } from "react-router";
import { ChevronsUpDown, LogOut, Settings, UserRound } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const currentUser = {
  name: "Muhammad Irfan",
  email: "muhammad@novaweb.studio",
  initials: "MI",
  initialsClassName: "bg-emerald-600 text-white",
};

/**
 * Account controls shared by the sidebar footer (full row with labels)
 * and the site header (compact avatar-only trigger).
 */
export function UserMenu({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "header";
}) {
  if (variant === "header") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Open account menu"
          >
            <Avatar aria-hidden>
              <AvatarFallback className={cn("text-xs font-medium", currentUser.initialsClassName)}>
                {currentUser.initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <UserMenuContent align="end" />
      </DropdownMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar aria-hidden>
                <AvatarFallback
                  className={cn("text-xs font-medium", currentUser.initialsClassName)}
                >
                  {currentUser.initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{currentUser.name}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {currentUser.email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <UserMenuContent align="start" />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserMenuContent({
  align,
}: {
  align: "start" | "end";
}) {
  return (
    <DropdownMenuContent
      align={align}
      side={align === "start" ? "top" : "bottom"}
      sideOffset={8}
      className="min-w-56 rounded-lg"
    >
      <DropdownMenuLabel className="flex flex-col gap-0.5 px-1.5 py-1">
        <span className="text-sm font-medium">{currentUser.name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {currentUser.email}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/profile">
          <UserRound />
          Profile
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/settings">
          <Settings />
          Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive">
        <LogOut />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
