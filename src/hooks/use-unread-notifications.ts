import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/** Quantidade de notificações não lidas do usuário (mesma consulta do sino, com realtime). */
export function useUnreadNotifications(): number {
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
    const chName = `notif-${user.id}-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(chName)
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

  return count;
}
