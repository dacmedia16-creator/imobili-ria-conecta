import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/visual/base";
import { ROTULO_PENDENCIA_PROPOSTA, type PendenciaProposta } from "@/lib/proposta-compra-tela";

/** Linha do "O que fazer hoje" para a proposta de compra (t_da0dac53). */
export function ItemPendenciaProposta({ p }: { p: PendenciaProposta }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5" data-kind={p.kind}>
      <Pill tom={p.kind === "proposta_vencendo" ? "amber" : "blue"}>
        {ROTULO_PENDENCIA_PROPOSTA[p.kind]}
      </Pill>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{p.detalhe}</p>
        <p className="text-xs text-muted-foreground">{p.imovel ?? "Imóvel sem descrição"}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to="/propostas/$id" params={{ id: p.propostaId }}>
          Abrir
        </Link>
      </Button>
    </li>
  );
}
