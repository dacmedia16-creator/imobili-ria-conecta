import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CompletarPerfilGate } from "@/components/CompletarPerfil";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: () => (
    <AuthProvider>
      <CompletarPerfilGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </CompletarPerfilGate>
    </AuthProvider>
  ),
});
