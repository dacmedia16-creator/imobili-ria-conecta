import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

export function NotificationBell() {
  const count = useUnreadNotifications();

  return (
    <Link
      to="/notificacoes"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-sidebar-accent"
      aria-label={`${count} notificações não lidas`}
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
