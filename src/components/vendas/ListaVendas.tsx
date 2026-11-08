// Lista de vendas compartilhada: tela Vendas e cartão "Vendas recentes" do Início (t_e99f64cb).
// Celular: cartões empilhados; computador (md+): tabela. A marcação é a mesma que a tela Vendas
// tinha antes da extração — mudar aqui muda as duas telas.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { AgingBadge } from "@/components/AgingBadge";
import { FinanciadaBadge } from "@/components/FinanciadaBadge";
import {
  VEZ_DE_AGIR_LABEL,
  vezDeAgir,
  type AgingLimites,
  type SaleStatus,
  type VezDeAgir,
} from "@/lib/status";
import { datasDaVendaNaLista, type DatasVendaLista } from "@/lib/vendas-lista-datas";
import {
  codigoDaVenda,
  nomesCorretores,
  nomesLideres,
  type LinhaListaVendas,
} from "@/lib/vendas-lista-linha";

/** "Criada em …" + "Assinada em …" / "Ainda não assinada" (legenda de cada data). */
function DatasVendaLegenda({
  datas,
  className,
  indisponivel = false,
}: {
  datas: DatasVendaLista;
  className?: string;
  /** Leitura da data oficial falhou (só no Início): não afirma "Ainda não assinada". */
  indisponivel?: boolean;
}) {
  return (
    <div className={className}>
      <div>Criada em {datas.criadaEm ?? "—"}</div>
      <div>
        {datas.assinadaEm
          ? `Assinada em ${datas.assinadaEm}`
          : indisponivel
            ? "Data da assinatura indisponível"
            : "Ainda não assinada"}
      </div>
    </div>
  );
}

/** Ordenação por coluna (só a tela Vendas usa). */
export type OrdenacaoListaVendas = {
  ariaSort: (campo: "valor" | "dias") => "ascending" | "descending" | "none";
  alternar: (campo: "valor" | "dias") => void;
  icone: (campo: "valor" | "dias") => ReactNode;
};

export function ListaVendas<T extends LinhaListaVendas>({
  vendas,
  profileName,
  liderIdByCorretor,
  mostrarLider,
  ehMinhaVez,
  desdeEtapa,
  assinadaNoHistorico,
  agingLimites,
  onAbrir,
  aoClicarLink,
  ordenacao,
  acao,
}: {
  vendas: T[];
  profileName: Record<string, string>;
  liderIdByCorretor: Record<string, string>;
  /** Coluna Gestor/Líder (quem enxerga vendas de várias equipes). */
  mostrarLider: boolean;
  ehMinhaVez: (s: T) => boolean;
  /** Início da etapa atual (última troca de status; sem histórico, a criação). */
  desdeEtapa: (s: T) => string;
  assinadaNoHistorico: (s: T) => boolean;
  agingLimites?: AgingLimites;
  onAbrir: (id: string) => void;
  /** Chamado ao clicar no código (link) da venda, antes de navegar. */
  aoClicarLink?: () => void;
  ordenacao?: OrdenacaoListaVendas;
  /** Botão por linha (ex.: excluir). Sem ele, a coluna de ação não aparece. */
  acao?: (s: T, tela: "celular" | "computador") => ReactNode;
}) {
  const datas = (s: T) => datasDaVendaNaLista(s, assinadaNoHistorico(s));
  return (
    <>
      {/* Mobile: cards empilhados — a tabela força colunas largas demais e corta o texto
          do status numa tela estreita. A partir de md, volta pra tabela (mais densa, melhor
          pra comparar várias vendas de uma vez, o que faz sentido numa tela maior). */}
      <div className="space-y-2 md:hidden">
        {vendas.map((s) => {
          const minhaVez = ehMinhaVez(s);
          return (
            <div
              key={s.id}
              className={`cursor-pointer rounded-md border p-3 ${minhaVez ? "border-primary/40 bg-primary/5" : ""}`}
              onClick={() => onAbrir(s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <LinkVenda s={s} className="truncate" aoClicar={aoClicarLink} />
                  <div className="truncate text-sm text-muted-foreground">
                    {nomesCorretores(s, profileName)}
                    {mostrarLider && nomesLideres(s, profileName, liderIdByCorretor) && (
                      <> · {nomesLideres(s, profileName, liderIdByCorretor)}</>
                    )}
                  </div>
                </div>
                {acao?.(s, "celular")}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={s.status as SaleStatus} />
                <VezDeAgirBadge status={s.status as SaleStatus} />
                <FinanciadaBadge
                  tipo={s.pagamento_tipo}
                  banco={s.pagamento_banco}
                  correspondente={s.pagamento_correspondente}
                  obaCredito={s.pagamento_oba}
                />
                {minhaVez && <SuaVezBadge />}
                <AgingBadge since={desdeEtapa(s)} limites={agingLimites} prefixo="Nesta etapa" />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-semibold tabular-nums">
                  {s.valor_negociado
                    ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}`
                    : "Valor pendente"}
                </span>
                <DatasVendaLegenda
                  datas={datas(s)}
                  indisponivel={s.data_venda === null}
                  className="text-right text-xs text-muted-foreground"
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imóvel / código</TableHead>
              <TableHead>Corretor</TableHead>
              {mostrarLider && <TableHead>Gestor/Líder</TableHead>}
              <TableHead
                className="text-right"
                aria-sort={ordenacao ? ordenacao.ariaSort("valor") : undefined}
              >
                {ordenacao ? (
                  <button
                    type="button"
                    className="-mr-1 inline-flex items-center rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => ordenacao.alternar("valor")}
                    aria-label="Ordenar por valor"
                  >
                    Valor
                    {ordenacao.icone("valor")}
                  </button>
                ) : (
                  "Valor"
                )}
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Vez de agir</TableHead>
              <TableHead aria-sort={ordenacao ? ordenacao.ariaSort("dias") : undefined}>
                {ordenacao ? (
                  <button
                    type="button"
                    className="-ml-1 inline-flex items-center rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => ordenacao.alternar("dias")}
                    aria-label="Ordenar por dias nesta etapa"
                  >
                    Nesta etapa
                    {ordenacao.icone("dias")}
                  </button>
                ) : (
                  "Nesta etapa"
                )}
              </TableHead>
              <TableHead>Datas</TableHead>
              {acao && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendas.map((s) => {
              const minhaVez = ehMinhaVez(s);
              return (
                <TableRow
                  key={s.id}
                  className={`cursor-pointer ${minhaVez ? "bg-primary/5" : ""}`}
                  onClick={() => onAbrir(s.id)}
                >
                  <TableCell>
                    <LinkVenda s={s} aoClicar={aoClicarLink} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {nomesCorretores(s, profileName)}
                  </TableCell>
                  {mostrarLider && (
                    <TableCell className="text-muted-foreground">
                      {nomesLideres(s, profileName, liderIdByCorretor) || "—"}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {s.valor_negociado ? (
                      <span className="font-semibold">
                        {`R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Pendente</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.status as SaleStatus} />
                      <FinanciadaBadge
                        tipo={s.pagamento_tipo}
                        banco={s.pagamento_banco}
                        correspondente={s.pagamento_correspondente}
                        obaCredito={s.pagamento_oba}
                      />
                      {minhaVez && <SuaVezBadge />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <VezDeAgirBadge status={s.status as SaleStatus} />
                  </TableCell>
                  <TableCell>
                    <AgingBadge since={desdeEtapa(s)} limites={agingLimites} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    <DatasVendaLegenda datas={datas(s)} indisponivel={s.data_venda === null} />
                  </TableCell>
                  {acao && <TableCell>{acao(s, "computador")}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/**
 * Código do imóvel como link de verdade: abre pelo teclado (Tab + Enter) e aceita
 * Ctrl/Cmd+clique ou botão do meio para abrir em nova aba. O clique não chega à linha.
 */
function LinkVenda({
  s,
  className,
  aoClicar,
}: {
  s: LinhaListaVendas;
  className?: string;
  aoClicar?: () => void;
}) {
  const codigo = codigoDaVenda(s);
  return (
    <Link
      to="/vendas/$id"
      params={{ id: s.id }}
      onClick={(e) => {
        e.stopPropagation();
        aoClicar?.();
      }}
      aria-label={`Abrir venda ${codigo}`}
      className={`inline-flex max-w-full items-center gap-0.5 rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ""}`}
    >
      <span className="truncate">{codigo}</span>
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}

/** "Sua vez" no azul da marca (vermelho fica só para atraso e exclusão). */
function SuaVezBadge() {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
      Sua vez
    </span>
  );
}

const VEZ_DE_AGIR_TONE: Record<VezDeAgir, string> = {
  corretor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  gestor: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  financeiro: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  juridico: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  concluido: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
};

function VezDeAgirBadge({ status }: { status: SaleStatus }) {
  const responsavel = vezDeAgir(status);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VEZ_DE_AGIR_TONE[responsavel]}`}
    >
      {VEZ_DE_AGIR_LABEL[responsavel]}
    </span>
  );
}
