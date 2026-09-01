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
import { useAuth } from "@/lib/auth";

/**
 * Account controls shared by the sidebar footer (full row) and the site
 * header (compact avatar-only). Shows the signed-in user from the session —
 * the app lives behind ProtectedRoute, so the user is always present.
 */

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function UserMenu({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "header";
}) {
  const { user } = useAuth();
  const name = user?.name ?? "";
  const email = user?.email ?? "";
  const initials = user ? initialsFor(user.name) : "";

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
              <AvatarFallback className="bg-emerald-600 text-xs font-medium text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <UserMenuContent name={name} email={email} align="end" />
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
                <AvatarFallback className="bg-emerald-600 text-xs font-medium text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {email}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <UserMenuContent name={name} email={email} align="start" />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserMenuContent({
  name,
  email,
  align,
}: {
  name: string;
  email: string;
  align: "start" | "end";
}) {
  const { refresh } = useAuth();

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      // Re-probe the session; ProtectedRoute bounces to /login when it ends.
      refresh();
    }
  };

  return (
    <DropdownMenuContent
      align={align}
      side={align === "start" ? "top" : "bottom"}
      sideOffset={8}
      className="min-w-56 rounded-lg"
    >
      <DropdownMenuLabel className="flex flex-col gap-0.5 px-1.5 py-1">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {email}
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
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => {
          void logout();
        }}
      >
        <LogOut />
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
