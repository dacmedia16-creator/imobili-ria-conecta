import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CompletarPerfilGate } from "@/components/CompletarPerfil";
import { FichaColaboradorGate } from "@/components/ficha/FichaColaboradorGate";
import { consumirRetornoDepoimento, guardarRetornoDepoimento } from "@/lib/depoimentos";

function armazenamento(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    const naPaginaDepoimento = location.pathname === "/depoimento";
    if (!data.session) {
      // Link do WhatsApp (t_c7cfaf00): a Conta MAX só devolve para /dashboard; guarda o pedido.
      if (naPaginaDepoimento) guardarRetornoDepoimento(armazenamento(), Date.now());
      throw redirect({ to: "/auth" });
    }
    // Consome sempre (mesmo já em /depoimento) para o pedido não sobrar e redirecionar depois.
    const voltarParaDepoimento = consumirRetornoDepoimento(armazenamento(), Date.now());
    if (voltarParaDepoimento && !naPaginaDepoimento) {
      throw redirect({ to: "/depoimento", replace: true });
    }
  },
  component: () => (
    <AuthProvider>
      <CompletarPerfilGate>
        <FichaColaboradorGate>
          <AppShell>
            <Outlet />
          </AppShell>
        </FichaColaboradorGate>
      </CompletarPerfilGate>
    </AuthProvider>
  ),
});
