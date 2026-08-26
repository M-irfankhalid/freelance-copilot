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
      <SidebarGroupLabel>Manage</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                isActive={isNavItemActive(pathname, item.url)}
                tooltip={item.title}
              >
                <Link to={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
