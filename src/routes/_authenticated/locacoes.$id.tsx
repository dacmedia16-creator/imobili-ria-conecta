import { createFileRoute } from "@tanstack/react-router";
import { LocacaoDetalhe } from "@/components/locacao/LocacaoDetalhe";
import { guardLocacaoRoute } from "@/lib/locacao-db";

// Esteira de uma locação (t_74426f94): stepper de 9 etapas, ação de cada papel e histórico.
export const Route = createFileRoute("/_authenticated/locacoes/$id")({
  head: () => ({ meta: [{ title: "Locação" }] }),
  beforeLoad: guardLocacaoRoute,
  component: LocacaoPage,
});

function LocacaoPage() {
  const { id } = Route.useParams();
  return <LocacaoDetalhe id={id} />;
}
