import type { ComponentType } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  Handshake,
  PiggyBank,
  Scale,
  Share2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { InfoDot } from "@/components/dashboard/shared";
import { money } from "@/components/vendas/shared";
import { KpiTile, type Tom } from "@/components/visual/base";
import type { ResumoFinanceiro } from "@/lib/financeiro-dashboard-types";

type IconType = ComponentType<{ className?: string }>;

/** Indicador do resumo financeiro no padrão visual (base.tsx). Só apresentação: o valor
 * chega pronto do cálculo, sem nenhuma transformação aqui. */
function Card1({
  label,
  valor,
  tone,
  info,
  icon = CircleDollarSign,
  tom = "blue",
}: {
  label: string;
  valor: string;
  tone?: string;
  info?: string;
  icon?: IconType;
  tom?: Tom;
}) {
  return (
    <KpiTile
      label={label}
      value={valor}
      icon={icon}
      tom={tom}
      valueClassName={tone}
      info={info ? <InfoDot text={info} /> : undefined}
    />
  );
}

export function SummaryCards({ resumo }: { resumo: ResumoFinanceiro }) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">1. Produção gerada</h2>
          <p className="text-xs text-muted-foreground">
            O resultado comercial criado pelas vendas assinadas no período.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Card1
            label="VGV de contratos assinados"
            icon={TrendingUp}
            tom="blue"
            valor={money(resumo.vgvEfetivado) ?? "—"}
            info="VGV comercial no mês da assinatura, proporcional à parte da REMAX e sem parceria externa. Lançamentos usam a entrada no Financeiro."
          />
          <Card1
            label="Comissão própria das vendas"
            icon={CircleDollarSign}
            tom="violet"
            valor={money(resumo.comissaoBruta) ?? "—"}
            info="Comissão gerada depois de excluir parceria externa, antes dos repasses internos."
          />
          <Card1
            label="Receita líquida da imobiliária"
            icon={Building2}
            tom="green"
            valor={money(resumo.receitaLiquidaImobiliaria) ?? "—"}
            tone="text-emerald-700 dark:text-emerald-400"
            info="Valor que sobra para a imobiliária depois de corretores, captadores, gestores, Team Leaders e extras. Usa a mesma fórmula do Desempenho."
          />
          <Card1
            label="Repasses internos da imobiliária"
            icon={Share2}
            tom="slate"
            valor={money(resumo.repassesInternos) ?? "—"}
            info="Valores descontados da parte da imobiliária para gestores, Team Leaders e extras com origem na imobiliária."
          />
          <Card1
            label="Parcerias externas"
            icon={Handshake}
            tom="slate"
            valor={money(resumo.parceriaExterna) ?? "—"}
            info="Controle separado. Este valor não entra na comissão nem na receita da REMAX."
          />
          <Card1
            label="Divergências abertas"
            icon={AlertTriangle}
            tom="amber"
            valor={String(resumo.divergenciasAbertas)}
            tone={resumo.divergenciasAbertas > 0 ? "text-amber-700" : ""}
            info="Pendências financeiras ainda não resolvidas. Esta fila não usa o filtro de período."
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">2. Caixa do período</h2>
          <p className="text-xs text-muted-foreground">
            O que estava previsto e o que efetivamente entrou.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Card1
            label="Previsto para receber"
            icon={CalendarDays}
            tom="blue"
            valor={money(resumo.previstoImobiliaria) ?? "—"}
            info="Parcelas com vencimento dentro do período, mesmo quando pertencem a vendas de meses anteriores."
          />
          <Card1
            label="Recebido no período"
            icon={ArrowDownToLine}
            tom="green"
            valor={money(resumo.recebidoImobiliaria) ?? "—"}
            tone="text-emerald-700 dark:text-emerald-400"
            info="Dinheiro efetivamente recebido nas parcelas filtradas."
          />
          <Card1
            label="Saldo do período"
            icon={Scale}
            tom="violet"
            valor={money(resumo.saldoAReceber) ?? "—"}
            info="Previsto no período menos o que já foi recebido."
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">3. Próximos recebimentos</h2>
          <p className="text-xs text-muted-foreground">
            O que está vencido e o que ainda deve entrar.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Card1
            label="Vencido"
            icon={AlertTriangle}
            tom="red"
            valor={money(resumo.vencido) ?? "—"}
            tone={resumo.vencido > 0 ? "text-destructive" : ""}
            info="Parcelas ainda não recebidas cuja data prevista já passou."
          />
          <Card1
            label="A vencer"
            icon={CalendarClock}
            tom="amber"
            valor={money(resumo.aVencer) ?? "—"}
            info="Parcelas ainda não recebidas com vencimento futuro."
          />
          <Card1
            label="Próximos 30 dias"
            icon={Wallet}
            tom="blue"
            valor={money(resumo.previsao30) ?? "—"}
            info="Parte do valor a vencer prevista para até 30 dias."
          />
          <Card1
            label="Próximos 60 dias"
            icon={Wallet}
            tom="blue"
            valor={money(resumo.previsao60) ?? "—"}
            info="Parte do valor a vencer prevista para até 60 dias."
          />
          <Card1
            label="Próximos 90 dias"
            icon={PiggyBank}
            tom="blue"
            valor={money(resumo.previsao90) ?? "—"}
            info="Parte do valor a vencer prevista para até 90 dias."
          />
        </div>
      </section>
    </div>
  );
}
