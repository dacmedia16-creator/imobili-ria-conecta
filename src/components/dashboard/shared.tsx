import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { type ChartConfig } from "@/components/ui/chart";
import { fetchResumoGrupoVenda, vgvAtivoTotal, type ResumoPorGrupo } from "@/lib/dashboard-perfil-query";
import { Send, CheckCircle2, DollarSign, Info, type LucideIcon } from "lucide-react";

/** Cores compartilhadas do gráfico "Comissão: prevista x concluída" — usado no Dashboard (Painel
 * financeiro, fila) e na Visão Executiva ("Comissão em carteira"), pra manter a mesma legenda/cor
 * nos dois lugares. */
export const comissaoChartConfig = {
  prevista: { label: "Prevista", color: "var(--color-chart-4)" },
  concluida: { label: "Concluída", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

/** Pontinho "i" no canto do card, com o texto explicando como aquele número foi calculado —
 * abre no hover (desktop) e no toque/clique (mobile, onde hover não existe). `stopPropagation` e
 * `preventDefault` no clique evitam disparar a navegação quando o card inteiro é um <Link>
 * (KpiCard com `to`). Compartilhado entre Dashboard e Visão Executiva — mesmo comportamento nas
 * duas telas. */
export function InfoDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group absolute right-1.5 top-1.5">
      <button
        type="button"
        aria-label="Como esse número foi calculado"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
        className={`grid h-4 w-4 place-items-center rounded-full transition-colors group-hover:bg-primary group-hover:text-primary-foreground ${
          open ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      <div
        role="tooltip"
        className={`pointer-events-none absolute right-0 top-6 z-10 w-56 max-w-[70vw] rounded-md bg-primary px-2.5 py-2 text-[11px] leading-snug text-primary-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto ${
          open ? "opacity-100 pointer-events-auto" : ""
        }`}
      >
        {text}
      </div>
    </div>
  );
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  to,
  info,
}: {
  icon: any;
  label: string;
  value: number | string;
  to?: string;
  info?: string;
}) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(
          String(value)
            .replace(/[^\d,.-]/g, "")
            .replace(/\./g, "")
            .replace(",", "."),
        );
  const isZero = !Number.isNaN(numeric) && numeric === 0;
  const inner = (
    <Card className={`relative ${to ? "transition hover:shadow-md" : ""}`}>
      {info && <InfoDot text={info} />}
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-md p-2 ${isZero ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div
            className={`text-xl font-semibold leading-none ${isZero ? "text-muted-foreground/50" : ""}`}
          >
            {value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground pr-4">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function MovimentacaoCard({
  icon: Icon,
  label,
  quantidade,
  vgv,
  info,
}: {
  icon: LucideIcon;
  label: string;
  quantidade: number;
  vgv?: number;
  info?: string;
}) {
  return (
    <Card className="relative">
      {info && <InfoDot text={info} />}
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-md p-2 ${quantidade === 0 ? "bg-muted text-muted-foreground/50" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div
            className={`text-xl font-semibold leading-none ${quantidade === 0 ? "text-muted-foreground/50" : ""}`}
          >
            {quantidade}
          </div>
          <div className="mt-1 text-xs text-muted-foreground pr-4">{label}</div>
          {vgv !== undefined && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              VGV: R$ {vgv.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Posição ATUAL de VGV (não confundir com a Movimentação do período, que é histórico de eventos) —
 * escopada por um conjunto de corretores, ou `"todas"` pra financeiro/admin/super_admin (que já
 * enxergam toda a `sales` via RLS). Usado no painel do Corretor (`[user.id]`) e do Gestor
 * (`Array.from(teamIds)`) no Dashboard, e na Visão Executiva ("da imobiliária").
 *
 * Cada venda pertence a exatamente um grupo pelo status ATUAL (classificarGrupoVenda é exaustivo e
 * mutuamente exclusivo) — por isso "VGV em andamento" + "VGV confirmado" nunca contam a mesma
 * venda duas vezes, e "VGV ativo total" (vgvAtivoTotal) é a soma direta dos dois sem risco de
 * sobreposição. Vendas de Lançamento que pulam contrato_assinado (vão direto de rascunho pra
 * ocorrencia_analise_financeiro — ver criar_ocorrencia_lancamento_rpc) já caem em "confirmada"
 * porque a classificação é só por status, não por modalidade nem por caminho percorrido.
 *
 * Não usa dashboard_stats() nem RPC nova — busca direta em `sales` (RLS já restringe pelo papel de
 * quem está logado) mais `agruparVendasPorGrupoComVgv` (dashboard-perfil-query.ts), pura e testada
 * isoladamente.
 */
export function ResumoGrupoVendaCards({
  corretorIds,
  sufixoLabel,
}: {
  corretorIds: string[] | "todas";
  sufixoLabel?: string;
}) {
  const idsKey = corretorIds === "todas" ? "todas" : [...corretorIds].sort().join(",");
  const [resumo, setResumo] = useState<ResumoPorGrupo | null>(null);

  useEffect(() => {
    if (idsKey !== "todas" && idsKey === "") {
      setResumo(null);
      return;
    }
    let cancelado = false;
    fetchResumoGrupoVenda(idsKey === "todas" ? "todas" : idsKey.split(","))
      .then((r) => {
        if (!cancelado) setResumo(r);
      })
      .catch((e: unknown) => {
        // Silencioso na interface de propósito: são cards a mais dentro de um painel que já tem
        // outros KPIs funcionando (vindos de dashboard_stats()) — um erro aqui não deve quebrar
        // nem exibir mensagem técnica sobre o resto do painel, só ficar de fora.
        console.error("fetchResumoGrupoVenda:", e);
      });
    return () => {
      cancelado = true;
    };
  }, [idsKey]);

  if (!resumo) return null;

  // Insere o sufixo (ex.: "da equipe", "da imobiliária") logo antes do travessão do rótulo
  // recomendado, mantendo o "— explicação" no final: "VGV em andamento da equipe — ainda não
  // confirmado".
  const rotulo = (base: string) => (sufixoLabel ? base.replace(" — ", ` ${sufixoLabel} — `) : base);
  const ativoTotal = vgvAtivoTotal(resumo);

  return (
    <>
      <MovimentacaoCard
        icon={Send}
        label={rotulo("VGV em andamento — ainda não confirmado")}
        quantidade={resumo.futura.quantidade}
        vgv={resumo.futura.vgv}
        info="Valor negociado das vendas em preparação ou futura agora — posição atual da
          carteira, diferente da Movimentação do período (que é histórico de eventos)."
      />
      <MovimentacaoCard
        icon={CheckCircle2}
        label={rotulo("VGV confirmado — contrato assinado ou já avançado ao financeiro")}
        quantidade={resumo.confirmada.quantidade}
        vgv={resumo.confirmada.vgv}
        info="Valor negociado das vendas com contrato assinado ou já em financeiro (Lançamento) —
          posição atual, sem duplicidade com “em andamento”."
      />
      <MovimentacaoCard
        icon={DollarSign}
        label={rotulo("VGV ativo total — sem duplicidade")}
        quantidade={ativoTotal.quantidade}
        vgv={ativoTotal.vgv}
        info="Soma direta de “em andamento” + “confirmado”. Cada venda ativa pertence a
          exatamente um desses dois grupos pelo status atual, então nunca é contada duas vezes."
      />
    </>
  );
}
