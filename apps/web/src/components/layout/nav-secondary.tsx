import { Link, useLocation } from "react-router";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { NavItem } from "@/lib/navigation";

function isNavItemActive(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function NavSecondary({
  items,
  className,
}: {
  items: NavItem[];
  className?: string;
}) {
  const { pathname } = useLocation();

  return (
    <SidebarGroup className={className}>
      <SidebarGroupLabel>Account</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.url);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.title}
                >
                  <Link
                    to={item.url}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
