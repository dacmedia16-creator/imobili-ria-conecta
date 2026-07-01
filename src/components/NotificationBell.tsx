import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function NotificationBell() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    const { count: c } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("lida", false);
    setCount(c ?? 0);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, load]);

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
