import { Link, useLocation } from "react-router";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { NavGroup } from "@/lib/navigation";

function isNavItemActive(pathname: string, url: string) {
  return url === "/dashboard"
    ? pathname === url
    : pathname === url || pathname.startsWith(`${url}/`);
}

export function NavMain({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.title ?? "primary"}>
          {group.title ? (
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
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
      ))}
    </>
  );
}
