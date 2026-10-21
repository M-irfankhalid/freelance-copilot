import * as React from "react";
import { Link, useLocation } from "react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { allNavItems, type NavItem } from "@/lib/navigation";

type Crumb = { label: string; href?: string };

function resolveCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ label: "Dashboard", href: "/dashboard" }];
  }

  const section: NavItem | undefined = allNavItems.find(
    (item) => item.url === `/${segments[0]}`
  );

  const crumbs: Crumb[] = [
    { label: section?.title ?? capitalize(segments[0]), href: section?.url },
  ];

  if (segments.length > 1 && section) {
    crumbs.push({ label: capitalize(segments[segments.length - 1]) });
  }

  return crumbs;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const crumbs = resolveCrumbs(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="flex flex-1 items-center gap-2 px-3 md:px-4">
        <SidebarTrigger aria-label="Toggle sidebar" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <React.Fragment key={`${crumb.label}-${index}`}>
                  <BreadcrumbItem>
                    {isLast || !crumb.href ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.href ?? "/"}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast ? <BreadcrumbSeparator /> : null}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-1 pr-3 md:pr-4">
        <UserMenu variant="header" />
      </div>
    </header>
  );
}
