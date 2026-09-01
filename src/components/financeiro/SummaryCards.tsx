import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import { money } from "@/components/vendas/shared";
import type { ResumoFinanceiro } from "@/lib/financeiro-dashboard-types";

function Card1({
  label,
  valor,
  tone,
  info,
}: {
  label: string;
  valor: string;
  tone?: string;
  info?: string;
}) {
  return (
    <Card className="relative">
      {info && <InfoDot text={info} />}
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground pr-4">{label}</p>
        <p className={`text-xl font-semibold ${tone ?? ""}`}>{valor}</p>
      </CardContent>
    </Card>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card1
            label="VGV de contratos assinados"
            valor={money(resumo.vgvEfetivado) ?? "—"}
            info="VGV comercial no mês da assinatura, proporcional à parte da REMAX e sem parceria externa. Lançamentos usam a entrada no Financeiro."
          />
          <Card1
            label="Comissão própria das vendas"
            valor={money(resumo.comissaoBruta) ?? "—"}
            info="Comissão gerada depois de excluir parceria externa, antes dos repasses internos."
          />
          <Card1
            label="Receita líquida da imobiliária"
            valor={money(resumo.receitaLiquidaImobiliaria) ?? "—"}
            tone="text-emerald-700 dark:text-emerald-400"
            info="Valor que sobra para a imobiliária depois de corretores, captadores, gestores, Team Leaders e extras. Usa a mesma fórmula do Desempenho."
          />
          <Card1
            label="Repasses internos da imobiliária"
            valor={money(resumo.repassesInternos) ?? "—"}
            info="Valores descontados da parte da imobiliária para gestores, Team Leaders e extras com origem na imobiliária."
          />
          <Card1
            label="Parcerias externas"
            valor={money(resumo.parceriaExterna) ?? "—"}
            info="Controle separado. Este valor não entra na comissão nem na receita da REMAX."
          />
          <Card1
            label="Divergências abertas"
            valor={String(resumo.divergenciasAbertas)}
            tone={resumo.divergenciasAbertas > 0 ? "text-destructive" : ""}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card1
            label="Previsto para receber"
            valor={money(resumo.previstoImobiliaria) ?? "—"}
            info="Parcelas com vencimento dentro do período, mesmo quando pertencem a vendas de meses anteriores."
          />
          <Card1
            label="Recebido no período"
            valor={money(resumo.recebidoImobiliaria) ?? "—"}
            tone="text-emerald-700 dark:text-emerald-400"
            info="Dinheiro efetivamente recebido nas parcelas filtradas."
          />
          <Card1
            label="Saldo do período"
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Card1
            label="Vencido"
            valor={money(resumo.vencido) ?? "—"}
            tone={resumo.vencido > 0 ? "text-destructive" : ""}
            info="Parcelas ainda não recebidas cuja data prevista já passou."
          />
          <Card1
            label="A vencer"
            valor={money(resumo.aVencer) ?? "—"}
            info="Parcelas ainda não recebidas com vencimento futuro."
          />
          <Card1
            label="Próximos 30 dias"
            valor={money(resumo.previsao30) ?? "—"}
            info="Parte do valor a vencer prevista para até 30 dias."
          />
          <Card1
            label="Próximos 60 dias"
            valor={money(resumo.previsao60) ?? "—"}
            info="Parte do valor a vencer prevista para até 60 dias."
          />
          <Card1
            label="Próximos 90 dias"
            valor={money(resumo.previsao90) ?? "—"}
            info="Parte do valor a vencer prevista para até 90 dias."
          />
        </div>
      </section>
    </div>
  );
}
