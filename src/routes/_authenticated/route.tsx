import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { CompletarPerfilGate } from "@/components/CompletarPerfil";
import { FichaColaboradorGate } from "@/components/ficha/FichaColaboradorGate";
import { ComemoraAniversarioPergunta } from "@/components/ComemoraAniversarioPergunta";
import { consumirRetornoDepoimento, guardarRetornoDepoimento } from "@/lib/depoimentos";
import { getRouteAccess } from "@/lib/route-access";
import { destinoFotografo } from "@/lib/fotografo";

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
    // Papel Fotógrafo (t_0666d3f0): o só-fotógrafo entra em /fotografo e não abre outras telas
    // (inclusive o /dashboard do login). O banco (RLS/is_active_user) é a proteção real dos dados.
    const access = await getRouteAccess();
    const destino = access ? destinoFotografo(access.roles, location.pathname) : null;
    if (destino) throw redirect({ to: destino, replace: true });
  },
  component: () => (
    <AuthProvider>
      <CompletarPerfilGate>
        <FichaColaboradorGate>
          <AppShell>
            <Outlet />
          </AppShell>
          <ComemoraAniversarioPergunta />
        </FichaColaboradorGate>
      </CompletarPerfilGate>
    </AuthProvider>
  ),
});
