import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  agruparPorPessoa,
  aplicarFiltrosProducao,
  podeAcessarProducaoPorPessoa,
  totaisProducao,
} from "@/lib/producao-por-pessoa-calc";
import { descreverPeriodo, filtrosPadrao } from "@/lib/producao-por-pessoa-filters";
import { fetchProducaoPorPessoa } from "@/lib/producao-por-pessoa-query";
import type { FiltrosProducao, ProducaoPonta } from "@/lib/producao-por-pessoa-types";
import { Filters } from "@/components/producao-por-pessoa/Filters";
import { TotalsCards } from "@/components/producao-por-pessoa/TotalsCards";
import { SummaryTable } from "@/components/producao-por-pessoa/SummaryTable";
import { DetailTable } from "@/components/producao-por-pessoa/DetailTable";

export const Route = createFileRoute("/_authenticated/producao-por-pessoa")({
  head: () => ({ meta: [{ title: "Produção por pessoa" }] }),
  // Mesma proteção em 3 camadas do Comparativo 6%: rota (aqui), componente (useAuth) e RPC
  // (producao_por_pessoa_dados, checada no banco independente da RLS).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { roles } = await loadMyAccess(session.user.id);
    if (!podeAcessarProducaoPorPessoa(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ProducaoPorPessoaPage,
});

function ProducaoPorPessoaPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["admin", "super_admin", "financeiro", "gestor", "team_leader"]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pontas, setPontas] = useState<ProducaoPonta[]>([]);
  const [filtros, setFiltros] = useState<FiltrosProducao>(filtrosPadrao());
  const [pessoaSelecionada, setPessoaSelecionada] = useState<string | null>(null);
  const detalheRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setErro(null);
    fetchProducaoPorPessoa()
      .then((r) => {
        if (!cancelado) setPontas(r);
      })
      .catch((err: unknown) => {
        console.error("fetchProducaoPorPessoa:", err);
        if (!cancelado)
          setErro(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  const pessoaOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pontas) if (p.pessoaId) m.set(p.pessoaId, p.pessoaNome);
    return Array.from(m.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [pontas]);

  const teamOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pontas) if (p.teamId) m.set(p.teamId, p.teamNome ?? p.teamId);
    return Array.from(m.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [pontas]);

  const filtradas = useMemo(() => aplicarFiltrosProducao(pontas, filtros), [pontas, filtros]);
  const resumo = useMemo(() => agruparPorPessoa(filtradas), [filtradas]);
  const totais = useMemo(() => totaisProducao(filtradas), [filtradas]);
  const operacoesPorPessoa = useMemo(() => {
    const porPessoa = new Map<string, Set<string>>();
    for (const ponta of filtradas) {
      const chave = ponta.pessoaId ?? `sem-vinculo:${ponta.pessoaNome}`;
      const operacoes = porPessoa.get(chave) ?? new Set<string>();
      operacoes.add(ponta.saleId);
      porPessoa.set(chave, operacoes);
    }
    return new Map(Array.from(porPessoa, ([chave, operacoes]) => [chave, operacoes.size]));
  }, [filtradas]);
  const pontasDetalhadas = useMemo(
    () =>
      pessoaSelecionada
        ? filtradas.filter((ponta) => {
            const chave = ponta.pessoaId ?? `sem-vinculo:${ponta.pessoaNome}`;
            return chave === pessoaSelecionada;
          })
        : filtradas,
    [filtradas, pessoaSelecionada],
  );

  const pessoaSelecionadaNome = useMemo(
    () => resumo.find((pessoa) => pessoa.chave === pessoaSelecionada)?.pessoaNome ?? null,
    [resumo, pessoaSelecionada],
  );

  const selecionarPessoa = (chave: string) => {
    const abrindo = pessoaSelecionada !== chave;
    setPessoaSelecionada(abrindo ? chave : null);
    // Leva o usuário até o detalhe filtrado: sem isso a tabela de baixo muda fora da tela e parece
    // que o clique em "Ver" não fez nada.
    if (abrindo) {
      requestAnimationFrame(() =>
        detalheRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  useEffect(() => {
    if (pessoaSelecionada && !resumo.some((pessoa) => pessoa.chave === pessoaSelecionada)) {
      setPessoaSelecionada(null);
    }
  }, [pessoaSelecionada, resumo]);

  if (authLoading || loading)
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Carregando relatório…
      </p>
    );

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores, financeiro, gestores e Team Leaders.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produção por pessoa</h1>
          <p className="text-sm font-medium text-foreground">
            Período: <span className="capitalize">{descreverPeriodo(filtros)}</span>
          </p>
          <p className="text-sm text-muted-foreground print:hidden">
            Mostra quem participou de cada venda do período e como: captação, venda ou as duas
            pontas. Para ver quanto cada pessoa ganhou, use o Desempenho.
          </p>
        </div>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir / baixar
        </Button>
      </div>

      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{erro}</CardContent>
        </Card>
      )}

      <Filters
        filtros={filtros}
        onChange={setFiltros}
        pessoaOptions={pessoaOptions}
        teamOptions={teamOptions}
      />
      <TotalsCards totais={totais} />
      <SummaryTable
        resumo={resumo}
        operacoesPorPessoa={operacoesPorPessoa}
        pessoaSelecionada={pessoaSelecionada}
        onSelecionarPessoa={selecionarPessoa}
      />
      <div ref={detalheRef} className="scroll-mt-4">
        <DetailTable
          pontas={pontasDetalhadas}
          pessoaNome={pessoaSelecionadaNome}
          onLimparPessoa={() => setPessoaSelecionada(null)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Cada venda completa equivale a 1 venda: numa venda padrão, 0,5 pra quem captou + 0,5 pra
        quem vendeu, cada ponta com metade do VGV; numa venda de Lançamento (sem captação), 1 venda
        inteira na ponta de venda. VGV sem parceria externa; a soma das pontas nunca duplica o VGV
        da operação. O período usa a data da assinatura válida mais recente; se a venda voltar para
        uma etapa anterior, deixa de contar até ser assinada novamente. Lançamentos usam a entrada
        no Financeiro. Vendas canceladas ou arquivadas ficam de fora.
      </p>
    </div>
  );
}
