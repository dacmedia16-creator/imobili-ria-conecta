import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  agruparPartes,
  completarPartesPelaRpc,
  dataBR,
  filtrarOrigem,
  filtrarPeriodo,
  mostrarFiltroOrigem,
  normalizarComissao,
  ordenarPorData,
  origensDisponiveis,
  partesConferem,
  totalComissao,
  type MinhaComissao,
  type OrigemDinheiro,
  type PartesPorVenda,
  type PeriodoDinheiro,
} from "@/lib/meu-dinheiro";
import { buscarPartesMinhas } from "@/lib/meu-dinheiro-partes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/visual/base";

// Minha carreira, PR 4 (cards t_5a47a73c e t_3f1d4f0f): bloco "Meu dinheiro". RPC minhas_comissoes da
// migração 20261016170000 (fora de types.ts): só a comissão do corretor logado, uma linha por venda.
const db = supabase as unknown as SupabaseClient;

const PERIODOS: { k: PeriodoDinheiro; rotulo: string; total: string }[] = [
  { k: "mes", rotulo: "Mês", total: "no mês" },
  { k: "ano", rotulo: "Ano", total: "no ano" },
  { k: "todas", rotulo: "Todas", total: "em todas as vendas" },
];

// Filtro "Minhas vendas / Do time" (t_31729652). Só aparece para quem tem comissão de time (TL/gestor);
// "Outras" (coordenação de lançamento) só para quem tem. Corretor sem time: sem filtro, tela como antes.
const ORIGENS: { k: OrigemDinheiro; rotulo: string; total: string }[] = [
  { k: "todas", rotulo: "Todas", total: "" },
  { k: "minhas", rotulo: "Minhas vendas", total: " · minhas vendas" },
  { k: "time", rotulo: "Do time", total: " · do time" },
  { k: "outras", rotulo: "Outras", total: " · outras" },
];

export function MeuDinheiro({ userId }: { userId: string }) {
  const hoje = useMemo(() => periodoAtual().hoje, []);
  const [lista, setLista] = useState<MinhaComissao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoDinheiro>("ano");
  const [partes, setPartes] = useState<PartesPorVenda | null>(null);
  const [origem, setOrigem] = useState<OrigemDinheiro>("todas");

  useEffect(() => {
    let alive = true;
    setLista(null);
    setErro(null);
    setPartes(null);
    setOrigem("todas");
    db.rpc("minhas_comissoes").then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setErro(errorMessage(error, "Não foi possível carregar as suas comissões."));
        return;
      }
      const l = ((data ?? []) as Record<string, unknown>[]).map(normalizarComissao);
      setLista(l);
      if (l.length === 0) return;
      // Divisão por papel: só exibição. Se falhar ou não bater com a RPC, o filtro não aparece.
      buscarPartesMinhas(
        db,
        userId,
        l.map((c) => c.sale_id),
      )
        .then((linhas) => {
          if (!alive) return;
          const p = completarPartesPelaRpc(l, agruparPartes(linhas));
          if (partesConferem(l, p)) setPartes(p);
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const origens = useMemo(
    () => (lista && partes ? origensDisponiveis(lista, partes) : []),
    [lista, partes],
  );
  const comFiltro = mostrarFiltroOrigem(origens);
  const origemAtiva: OrigemDinheiro = comFiltro ? origem : "todas";
  const linhas = useMemo(() => {
    if (!lista) return [];
    const base = partes ? filtrarOrigem(lista, partes, origemAtiva) : lista;
    return ordenarPorData(filtrarPeriodo(base, periodo, hoje));
  }, [lista, partes, origemAtiva, periodo, hoje]);
  const atual = PERIODOS.find((p) => p.k === periodo)!;
  const atualOrigem = ORIGENS.find((o) => o.k === origemAtiva)!;
  const opcoesOrigem = ORIGENS.filter(
    (o) => o.k === "todas" || (origens as OrigemDinheiro[]).includes(o.k),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="h-5 w-5" aria-hidden /> Meu dinheiro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A comissão a que você tem direito em cada venda assinada. Só você, o financeiro e a gestão
          veem.
        </p>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="meu-dinheiro">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !lista ? (
          <ListSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="rounded-lg bg-muted/50 p-2">
                <span className="block text-xs text-muted-foreground">
                  Minha comissão {atual.total}
                  {atualOrigem.total}
                </span>
                <b className="text-xl tabular-nums" data-testid="meu-dinheiro-total">
                  {brl(totalComissao(linhas))}
                </b>
              </div>
              <div className="flex gap-2" role="group" aria-label="Período">
                {PERIODOS.map((p) => (
                  <Button
                    key={p.k}
                    size="sm"
                    variant={periodo === p.k ? "default" : "outline"}
                    onClick={() => setPeriodo(p.k)}
                  >
                    {p.rotulo}
                  </Button>
                ))}
              </div>
            </div>
            {comFiltro ? (
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Origem da comissão"
                data-testid="meu-dinheiro-origem"
              >
                {opcoesOrigem.map((o) => (
                  <Button
                    key={o.k}
                    size="sm"
                    variant={origemAtiva === o.k ? "default" : "outline"}
                    aria-pressed={origemAtiva === o.k}
                    onClick={() => setOrigem(o.k)}
                  >
                    {o.rotulo}
                  </Button>
                ))}
              </div>
            ) : null}
            {linhas.length === 0 ? (
              <EmptyState>
                {origemAtiva === "todas"
                  ? `Nenhuma venda assinada com comissão sua ${atual.total}. Assim que uma venda sua for assinada com comissão lançada, ela aparece aqui.`
                  : `Nenhuma comissão ${atual.total} nesta opção (${atualOrigem.rotulo}).`}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Assinada em</th>
                      <th className="py-1 pr-2 font-medium">Imóvel</th>
                      <th className="py-1 text-right font-medium">Minha comissão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((c) => (
                      <tr key={c.sale_id} className="border-t">
                        <td className="whitespace-nowrap py-2 pr-2">{dataBR(c.venda_em)}</td>
                        <td className="py-2 pr-2">
                          {c.imovel ?? "Venda"}
                          {c.papel ? (
                            <span className="block text-xs text-muted-foreground">{c.papel}</span>
                          ) : null}
                        </td>
                        <td className="py-2 text-right tabular-nums">{brl(c.minha_comissao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
