import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OPCOES_SITUACAO, type SituacaoFiltro } from "@/lib/meu-plano-2027/filtro-equipe";

/**
 * Busca por nome + filtro por situação + "X de Y" + Limpar (t_8960c522). Componente ÚNICO, usado pela lista
 * "Meu Plano 2027 — equipe" e pelos rankings do painel de metas (t_adaaa240): mesmos rótulos, mesma normalização de
 * acentos (filtro-equipe.ts). Só exibição: quem usa guarda o estado e decide o que esconder.
 */
export function BuscaFiltroPlano({
  busca,
  setBusca,
  situacao,
  setSituacao,
  porSituacao,
  visiveis,
  total,
  unidade = "pessoas",
  placeholder = "Buscar pelo nome",
  semSituacao = false,
}: {
  busca: string;
  setBusca: (v: string) => void;
  situacao: SituacaoFiltro;
  setSituacao: (v: SituacaoFiltro) => void;
  /** Quantos em cada situação (sobre o total), mostrado no seletor. */
  porSituacao: Record<SituacaoFiltro, number>;
  visiveis: number;
  total: number;
  unidade?: string;
  placeholder?: string;
  /** Sem as etiquetas (módulo desligado ou leitura recusada): só a busca. */
  semSituacao?: boolean;
}) {
  const filtrando = busca.trim() !== "" || situacao !== "todos";
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center" data-testid="filtros-equipe">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pl-8"
            data-testid="busca-equipe"
          />
        </div>
        {semSituacao ? null : (
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as SituacaoFiltro)}
            aria-label="Filtrar por situação"
            className="h-10 rounded-md border border-input bg-background px-3 text-base md:text-sm sm:w-60"
            data-testid="filtro-situacao"
          >
            {OPCOES_SITUACAO.map((o) => (
              <option key={o.id} value={o.id}>
                {o.texto} ({porSituacao[o.id]})
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex min-h-7 items-center justify-between text-xs text-muted-foreground">
        <span data-testid="contagem-filtro" aria-live="polite">
          {visiveis} de {total} {unidade}
        </span>
        {filtrando ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setBusca("");
              setSituacao("todos");
            }}
            data-testid="limpar-filtro"
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Limpar
          </Button>
        ) : null}
      </div>
    </>
  );
}
