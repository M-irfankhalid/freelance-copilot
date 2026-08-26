"use client";

import * as React from "react";
import {
  Bell,
  CheckCheck,
  FileText,
  RefreshCw,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  title: string;
  detail: string;
  time: string;
  icon: LucideIcon;
  read: boolean;
};

const initialNotifications: Notification[] = [
  {
    id: "match-92",
    title: "Strong match found",
    detail: "“Next.js SaaS dashboard” on Freelancer.com scored 92%.",
    time: "2m ago",
    icon: Target,
    read: false,
  },
  {
    id: "proposal-viewed",
    title: "Proposal viewed by client",
    detail: "Acme Corp opened “E-commerce replatform proposal”.",
    time: "1h ago",
    icon: FileText,
    read: false,
  },
  {
    id: "bid-limit",
    title: "Auto Pilot paused",
    detail: "Daily bid limit of 10 reached. Resumes tomorrow at 09:00.",
    time: "3h ago",
    icon: Zap,
    read: false,
  },
  {
    id: "sync-complete",
    title: "Sync completed",
    detail: "Freelancer.com synced 14 new jobs matching your skills.",
    time: "5h ago",
    icon: RefreshCw,
    read: true,
  },
];

export function NotificationsMenu() {
  const [notifications, setNotifications] =
    React.useState(initialNotifications);
  const unreadCount = notifications.filter((item) => !item.read).length;

  const markAllRead = () =>
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadCount} unread)`
              : "Notifications"
          }
        >
          <Bell />
          {unreadCount > 0 ? (
            <span
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background"
              aria-hidden
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 min-w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0 text-sm font-medium text-foreground">
            Notifications
          </DropdownMenuLabel>
          <Button
            variant="ghost"
            size="xs"
            onClick={markAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck data-icon="inline-start" />
            Mark all read
          </Button>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <ul className="max-h-80 overflow-y-auto">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                "flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/60",
                !notification.read && "bg-muted/40"
              )}
            >
              <span
                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
                aria-hidden
              >
                <notification.icon className="size-3.5" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm leading-tight font-medium">
                  {notification.title}
                  {!notification.read ? (
                    <span
                      className="ml-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle"
                      aria-label="Unread"
                    />
                  ) : null}
                </p>
                <p className="text-xs leading-snug text-muted-foreground">
                  {notification.detail}
                </p>
                <p className="text-[0.7rem] text-muted-foreground/70">
                  {notification.time}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
