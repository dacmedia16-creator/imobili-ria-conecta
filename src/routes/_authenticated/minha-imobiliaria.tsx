import { createFileRoute } from "@tanstack/react-router";
import { Warehouse } from "lucide-react";
import { requireRoles } from "@/lib/route-access";
import { podeVerMinhaImobiliaria } from "@/lib/minha-imobiliaria/acesso";
import { nomeMes } from "@/lib/minha-imobiliaria/resumo";
import { PageHeader } from "@/components/visual/base";
import {
  MinhaImobiliaria,
  useMinhaImobiliaria,
} from "@/components/minha-imobiliaria/MinhaImobiliaria";

// Minha imobiliária (cartão t_f7f1b3e4; maquete v2 aprovada por Denis em 20/11/2026, tópico 6238).
// Três camadas: rota (aqui: só admin e Administrador principal), menu e RPC (minha_imobiliaria_resumo e
// minha_imobiliaria_atividades recusam quem não é dono/admin desta imobiliária). Só leitura.
export const Route = createFileRoute("/_authenticated/minha-imobiliaria")({
  head: () => ({ meta: [{ title: "Minha imobiliária" }] }),
  beforeLoad: ({ context }) => requireRoles(context.auth, podeVerMinhaImobiliaria),
  component: MinhaImobiliariaPage,
});

function MinhaImobiliariaPage() {
  const { dados, erro, hoje } = useMinhaImobiliaria();
  const [a, m, d] = (dados?.resumo.hoje || hoje).split("-").map(Number);
  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:p-2">
      <PageHeader
        icon={Warehouse}
        title="Minha imobiliária"
        description={
          <>
            Como a empresa está indo e o que precisa de você hoje. Números de{" "}
            <b className="text-foreground">
              {nomeMes(m)}/{a}
            </b>{" "}
            até hoje (dia {d}).
          </>
        }
      />
      <MinhaImobiliaria dados={dados} erro={erro} />
    </div>
  );
}
