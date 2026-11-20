import { createFileRoute } from "@tanstack/react-router";
import { requireRoles } from "@/lib/route-access";
import { podeAcessarPainelImobiliaria } from "@/lib/metas-2027/acesso";
import { PainelMetasImobiliaria } from "@/components/metas-2027/PainelMetasImobiliaria";

// Painel de metas 2027 · Imobiliária (cartão t_69d29df6). Tela NOVA, separada do Painel da Equipe e do Farol.
// Três camadas: rota (aqui: gestor, admin, super_admin), menu e RPC (o banco só devolve a imobiliária inteira para
// o broker; a bruta e o estoque só saem para admin/gestor; a meta da direção só é gravada pelo admin).
export const Route = createFileRoute("/_authenticated/painel-metas-imobiliaria")({
  head: () => ({ meta: [{ title: "Metas 2027 · Imobiliária" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, podeAcessarPainelImobiliaria),
  component: () => (
    <div className="mx-auto max-w-6xl space-y-4 sm:p-2">
      <PainelMetasImobiliaria />
    </div>
  ),
});
