import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-access";
import { podeAcessarPainelEquipe } from "@/lib/painel-equipe-calc";
import { PainelMetasGestor } from "@/components/metas-2027/PainelMetasGestor";

// Painel de metas 2027 · Equipes (cartão t_863b7590). Tela NOVA, separada do Painel da Equipe e do Farol.
// Três camadas: rota (aqui: gestor, TL, admin, super_admin), menu e RPC (metas_equipe_* recusa os demais e
// restringe o TL à equipe dele).
export const Route = createFileRoute("/_authenticated/painel-metas")({
  head: () => ({ meta: [{ title: "Metas 2027 · Equipes" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, podeAcessarPainelEquipe),
  component: () => (
    <div className="mx-auto max-w-6xl space-y-4 sm:p-2">
      <PainelMetasGestor />
    </div>
  ),
});
