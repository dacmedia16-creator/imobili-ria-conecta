import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
    // Usuário criado pelo admin/gestor precisa trocar a senha temporária antes de usar o resto do app.
    if (data.session.user.user_metadata?.must_change_password) {
      throw redirect({ to: "/trocar-senha" });
    }
  },
  component: () => (
    <AuthProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthProvider>
  ),
});
