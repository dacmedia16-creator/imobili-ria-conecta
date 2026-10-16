import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  aReceber,
  dataBR,
  normalizarParcela,
  recebidas,
  resumoDinheiro,
  valorRecebido,
  type MinhaParcela,
} from "@/lib/meu-dinheiro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";

// Minha carreira, PR 4 (card t_5a47a73c): bloco "Meu dinheiro". RPC minhas_comissoes da
// migração 20261016170000 (fora de types.ts): só a parte do corretor logado, na imobiliária ativa.
const db = supabase as unknown as SupabaseClient;

export function MeuDinheiro({ userId }: { userId: string }) {
  const hoje = useMemo(() => periodoAtual().hoje, []);
  const [lista, setLista] = useState<MinhaParcela[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"rec" | "pago">("rec");

  useEffect(() => {
    let alive = true;
    setLista(null);
    setErro(null);
    db.rpc("minhas_comissoes").then(({ data, error }) => {
      if (!alive) return;
      if (error) setErro(errorMessage(error, "Não foi possível carregar as suas comissões."));
      else setLista(((data ?? []) as Record<string, unknown>[]).map(normalizarParcela));
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const resumo = useMemo(() => (lista ? resumoDinheiro(lista, hoje) : null), [lista, hoje]);
  const linhas = lista ? (aba === "rec" ? aReceber(lista) : recebidas(lista)) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="h-5 w-5" aria-hidden /> Meu dinheiro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Somente a sua parte da comissão, parcela a parcela. O detalhe só você, o financeiro e a
          gestão veem.
        </p>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="meu-dinheiro">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !lista || !resumo ? (
          <ListSkeleton />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Kpi rotulo={`Recebido em ${hoje.slice(0, 4)}`} valor={brl(resumo.recebidoNoAno)} />
              <Kpi rotulo="A receber" valor={brl(resumo.aReceber)} />
              <Kpi
                rotulo="Próximo pagamento"
                valor={resumo.proximo ? dataBR(resumo.proximo).slice(0, 5) : "—"}
                extra={resumo.proximoAtrasado ? <Pill tom="amber">atrasado</Pill> : null}
              />
            </div>
            <div className="flex gap-2" role="group" aria-label="Parcelas">
              <Button
                size="sm"
                variant={aba === "rec" ? "default" : "outline"}
                onClick={() => setAba("rec")}
              >
                A receber
              </Button>
              <Button
                size="sm"
                variant={aba === "pago" ? "default" : "outline"}
                onClick={() => setAba("pago")}
              >
                Recebidas
              </Button>
            </div>
            {linhas.length === 0 ? (
              <EmptyState>
                {aba === "rec" ? "Nada a receber no momento." : "Nenhuma parcela recebida ainda."}{" "}
                Assim que uma venda sua tiver comissão lançada, as parcelas aparecem aqui.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Data</th>
                      <th className="py-1 pr-2 font-medium">Imóvel</th>
                      <th className="hidden py-1 pr-2 font-medium sm:table-cell">Parcela</th>
                      <th className="py-1 text-right font-medium">Minha parte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((p) => {
                      const d = aba === "rec" ? p.data_prevista : p.recebido_em;
                      const atrasada =
                        aba === "rec" && p.data_prevista != null && p.data_prevista < hoje;
                      return (
                        <tr key={`${p.occurrence_id}-${p.parcela}`} className="border-t">
                          <td className="whitespace-nowrap py-2 pr-2">
                            {dataBR(d)} {atrasada ? <Pill tom="amber">atrasada</Pill> : null}
                          </td>
                          <td className="py-2 pr-2">
                            {p.imovel ?? "Venda"}
                            {p.papel ? (
                              <span className="block text-xs text-muted-foreground">{p.papel}</span>
                            ) : null}
                          </td>
                          <td className="hidden py-2 pr-2 sm:table-cell">
                            {p.parcela}/{p.parcelas}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {brl(aba === "rec" ? p.valor_previsto : valorRecebido(p))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {resumo.semData > 0 && aba === "rec" ? (
              <p className="text-xs text-muted-foreground">
                {resumo.semData === 1
                  ? "1 comissão ainda sem previsão de recebimento."
                  : `${resumo.semData} comissões ainda sem previsão de recebimento.`}{" "}
                A data é lançada pelo financeiro.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <span className="block text-xs text-muted-foreground">{rotulo}</span>
      <b className="text-base tabular-nums">{valor}</b> {extra}
    </div>
  );
}
