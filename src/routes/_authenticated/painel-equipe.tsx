import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { loadMyAccess } from "@/lib/platform-context";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { STATUS_LABEL } from "@/lib/status";
import {
  COLUNAS_FUNIL,
  colunaDoStatus,
  diasEntre,
  diasSemVender,
  ganhoDoLider,
  mesAnterior,
  mesDaData,
  nivelSemVender,
  PAPEIS_PAINEL_EQUIPE,
  pendenciasAndamento,
  podeAcessarPainelEquipe,
  pontasDoPainel,
  rankingEquipe,
  recebimentosDoMes,
  resumoMes,
  variacao,
  vencimentoExclusiva,
  vezDoStatus,
  type PainelEquipeDados,
  type PainelEquipeOpcao,
  type VezFunil,
} from "@/lib/painel-equipe-calc";

// painel_equipe_* ainda não consta do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/_authenticated/painel-equipe")({
  head: () => ({ meta: [{ title: "Painel da Equipe" }] }),
  // Três camadas: rota (aqui), componente (useAuth) e RPC (painel_equipe_permitido no banco).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { roles } = await loadMyAccess(session.user.id);
    if (!podeAcessarPainelEquipe(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: PainelEquipePage,
});

const R = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const Q = (n: number) => (Math.round(n * 10) / 10).toLocaleString("pt-BR");
const dt = (d: string | null | undefined) =>
  d ? d.slice(0, 10).split("-").reverse().join("/") : "—";
const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

const VEZ_ESTILO: Record<VezFunil, { borda: string; texto: string }> = {
  corretor: { borda: "border-l-amber-600", texto: "Vez do corretor" },
  gestor: { borda: "border-l-blue-700", texto: "Vez do gestor/TL" },
  juridico: { borda: "border-l-slate-500", texto: "Vez do jurídico/cliente" },
  financeiro: { borda: "border-l-violet-600", texto: "Vez do financeiro" },
  concluida: { borda: "border-l-green-700", texto: "Concluída" },
};

function ultimosMeses(hoje: string, n = 12): string[] {
  const out: string[] = [];
  let m = hoje.slice(0, 7);
  for (let i = 0; i < n; i++) {
    out.push(m);
    m = mesAnterior(m);
  }
  return out;
}

function Comparacao({
  atual,
  anterior,
  mesAnt,
}: {
  atual: number;
  anterior: number;
  mesAnt: string;
}) {
  const d = variacao(atual, anterior);
  if (d == null)
    return <span className="text-xs text-muted-foreground">sem base no mês anterior</span>;
  return (
    <span className={`text-xs font-semibold ${d >= 0 ? "text-green-700" : "text-red-700"}`}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}% vs{" "}
      {nomeMes(mesAnt).split("/")[0].toLowerCase()}
    </span>
  );
}

function PainelEquipePage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny([...PAPEIS_PAINEL_EQUIPE]);
  const isAdmin = hasAny(["admin", "super_admin"]);
  const hoje = hojeSaoPaulo();
  const meses = useMemo(() => ultimosMeses(hoje), [hoje]);

  const [equipes, setEquipes] = useState<PainelEquipeOpcao[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [mes, setMes] = useState(meses[0]);
  const [dados, setDados] = useState<PainelEquipeDados | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let cancelado = false;
    void db.rpc("painel_equipe_equipes").then(({ data, error }) => {
      if (cancelado) return;
      if (error) {
        toast.error("Não foi possível carregar as equipes.");
        setEquipes([]);
        return;
      }
      const lista = (data ?? []) as PainelEquipeOpcao[];
      setEquipes(lista);
      setTeamId((atual) => atual ?? lista[0]?.id ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [allowed]);

  useEffect(() => {
    if (!teamId) return;
    let cancelado = false;
    setCarregando(true);
    void db
      .rpc("painel_equipe_dados", { _team_id: teamId, _mes: `${mes}-01` })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          toast.error("Não foi possível carregar o painel desta equipe.");
          setDados(null);
        } else setDados(data as PainelEquipeDados);
        setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [teamId, mes]);

  if (authLoading) return <div className="p-8 text-center text-muted-foreground">Carregando…</div>;
  if (!allowed)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a gestores, team leaders e administradores.
        </CardContent>
      </Card>
    );
  if (equipes && equipes.length === 0)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Você não lidera nenhuma equipe nesta imobiliária.
        </CardContent>
      </Card>
    );

  const equipeAtual = equipes?.find((e) => e.id === teamId) ?? null;

  return (
    <div className="space-y-6">
      {/* BLOCO 1: topo */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Painel da Equipe {equipeAtual ? `— ${equipeAtual.nome}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">
              Vendas contadas pelo <b>mês da assinatura do contrato</b> (horário de Brasília).
              Recebimentos contados pela <b>data da parcela</b>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              Mês
              <select
                className="rounded-md border bg-background px-2 py-1.5"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
              >
                {meses.map((m) => (
                  <option key={m} value={m}>
                    {nomeMes(m)}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin && (equipes?.length ?? 0) > 1 && (
              <label className="flex items-center gap-2">
                Equipe
                <select
                  className="rounded-md border bg-background px-2 py-1.5"
                  value={teamId ?? ""}
                  onChange={(e) => setTeamId(e.target.value)}
                >
                  {equipes?.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </CardContent>
      </Card>

      {carregando || !dados ? (
        <div className="p-8 text-center text-muted-foreground">Carregando…</div>
      ) : (
        <PainelEquipeConteudo dados={dados} mes={mes} hoje={hoje} />
      )}
    </div>
  );
}

/** Blocos 1 (números) a 7 do painel, a partir dos dados já carregados da RPC. */
export function PainelEquipeConteudo({
  dados,
  mes,
  hoje,
}: {
  dados: PainelEquipeDados;
  mes: string;
  hoje: string;
}) {
  const [pessoaAberta, setPessoaAberta] = useState<string | null>(null);
  const pontas = useMemo(() => pontasDoPainel(dados), [dados]);
  const mesAnt = mesAnterior(mes);
  const r = useMemo(() => resumoMes(dados, pontas, mes), [dados, pontas, mes]);
  const a = useMemo(() => resumoMes(dados, pontas, mesAnt), [dados, pontas, mesAnt]);
  const ganho = useMemo(() => ganhoDoLider(dados, mes), [dados, mes]);
  const ranking = useMemo(() => rankingEquipe(dados, pontas, mes), [dados, pontas, mes]);
  const receb = useMemo(() => recebimentosDoMes(dados, pontas, mes), [dados, pontas, mes]);
  const semVender = useMemo(() => diasSemVender(dados, hoje), [dados, hoje]);
  const nomePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pontas) if (p.pessoaId) m.set(p.pessoaId, p.pessoaNome);
    for (const x of dados.membros) m.set(x.user_id, x.nome);
    return m;
  }, [pontas, dados]);
  const primeiroNome = (id: string) => (nomePorId.get(id) ?? "—").split(" ")[0];
  const metaValor = Number(dados.meta?.meta_comissao ?? 0);
  const pct = metaValor > 0 ? Math.min(100, (r.comissaoPessoal / metaValor) * 100) : 0;
  const exclusivas = dados.exclusivas;

  return (
    <>
      <div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ["VGV da equipe", R(r.vgv), r.vgv, a.vgv],
              ["VGC da equipe", R(r.vgc), r.vgc, a.vgc],
              ["Imóveis vendidos", Q(r.qtd), r.qtd, a.qtd],
              ["Ticket médio", R(r.ticket), r.ticket, a.ticket],
              ["Equipe recebe no mês", R(r.recebeEquipe), r.recebeEquipe, a.recebeEquipe],
              [
                "Comissão do pessoal no mês",
                R(r.comissaoPessoal),
                r.comissaoPessoal,
                a.comissaoPessoal,
              ],
            ] as const
          ).map(([t, v, x, y]) => (
            <Card key={t}>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">{t}</div>
                <div className="my-1 text-xl font-bold">{v}</div>
                <Comparacao atual={x} anterior={y} mesAnt={mesAnt} />
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          VGV e VGC contam só a <b>parte dos membros desta equipe</b> (mesma regra da Produção por
          pessoa): venda comum = captação 50% + venda 50%; parceria com outra imobiliária = a venda
          inteira fica com o lado da casa; Lançamento = rateio pela comissão de cada vendedor.
        </p>
      </div>

      {/* BLOCO 2: quanto eu vou ganhar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Quanto EU vou ganhar no mês — {nomePorId.get(dados.eu_id ?? "") ?? "líder da equipe"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border-2 p-4">
              <div className="text-xs text-muted-foreground">Só as vendas pessoais</div>
              <div className="text-2xl font-extrabold">{R(ganho.a)}</div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {ganho.pessoais.length ? (
                    ganho.pessoais.map((x) => (
                      <tr key={x.saleId} className="border-b">
                        <td className="py-1">{x.codigo ?? "—"}</td>
                        <td className="py-1 text-right">{R(x.valor)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="py-1 text-muted-foreground">
                        Nenhuma venda pessoal assinada no mês
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border-2 border-green-700 p-4">
              <div className="text-xs text-muted-foreground">
                Vendas pessoais + comissão de líder já lançada nas vendas{" "}
                <Badge variant="secondary">é o que vale</Badge>
              </div>
              <div className="text-2xl font-extrabold">{R(ganho.b)}</div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-1">Vendas pessoais</td>
                    <td className="py-1 text-right">{R(ganho.a)}</td>
                  </tr>
                  {ganho.lider.map((x) => (
                    <tr key={x.saleId} className="border-b">
                      <td className="py-1">Líder em {x.codigo ?? "—"}</td>
                      <td className="py-1 text-right">+ {R(x.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
            Não há percentual automático do líder sobre a produção da equipe. Entra só a comissão de
            líder lançada venda a venda (campo “Líder” do lado captador/vendedor e “+ Gestor / +
            Team Leader” na divisão de comissão).
          </p>
        </CardContent>
      </Card>

      {/* BLOCO 3: ranking */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Ranking da equipe — clique num corretor para ver as vendas dele
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-2">#</th>
                <th className="p-2">Corretor</th>
                <th className="p-2 text-right">VGV (parte dele)</th>
                <th className="p-2 text-right">VGC (parte dele)</th>
                <th className="p-2 text-right">Vendas</th>
                <th className="p-2 text-right">Vai ganhar no mês</th>
                <th className="p-2">Parceria</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((x, i) => (
                <tr
                  key={x.userId}
                  className="cursor-pointer border-b hover:bg-muted"
                  onClick={() => setPessoaAberta(x.userId)}
                >
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">
                    <b>{x.nome}</b> {x.papel === "lider" && <Badge variant="outline">Líder</Badge>}
                    {x.papel === "co_lider" && <Badge variant="outline">Líder auxiliar</Badge>}
                  </td>
                  <td className="p-2 text-right">{R(x.vgv)}</td>
                  <td className="p-2 text-right">{R(x.vgc)}</td>
                  <td className="p-2 text-right">{Q(x.qtd)}</td>
                  <td className="p-2 text-right font-semibold">{R(x.ganho)}</td>
                  <td className="p-2">
                    {x.parceria && (
                      <Badge className="bg-violet-100 text-violet-700">parceria</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            “Vai ganhar no mês” = comissão de cada pessoa nas vendas assinadas no mês. Parceria = a
            venda é dividida com corretor de outra equipe ou de fora; só a fração desta equipe
            entra.
          </p>
        </CardContent>
      </Card>

      {/* BLOCO 4: funil */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Andamento das vendas da equipe — de quem é a vez
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUNAS_FUNIL.map((c) => {
              const vs = dados.andamento.filter((x) => colunaDoStatus(x.status) === c.k);
              return (
                <div key={c.k} className="rounded-lg border bg-muted/40 p-2">
                  <h3 className="mb-2 flex justify-between text-sm font-semibold">
                    {c.titulo} <Badge variant="secondary">{vs.length}</Badge>
                  </h3>
                  {vs.length === 0 && (
                    <div className="text-xs text-muted-foreground">nada aqui</div>
                  )}
                  {vs.map((v) => {
                    const vez = VEZ_ESTILO[vezDoStatus(v.status)];
                    return (
                      <a
                        key={v.sale_id}
                        href={`/vendas/${v.sale_id}`}
                        className={`mb-2 block rounded-md border border-l-4 bg-background p-2 text-xs ${vez.borda}`}
                      >
                        <b>{v.codigo ?? "—"}</b> {v.bairro ? `· ${v.bairro}` : ""}
                        <div className="text-muted-foreground">
                          {v.membros.map(primeiroNome).join(", ")} ·{" "}
                          {R(Number(v.valor_negociado ?? 0))}
                        </div>
                        {v.parceria && (
                          <Badge className="mr-1 bg-violet-100 text-violet-700">parceria</Badge>
                        )}
                        {v.modalidade === "lancamento" && (
                          <Badge variant="outline">Lançamento</Badge>
                        )}
                        <div className="mt-1 font-semibold">
                          {vez.texto} · {STATUS_LABEL[v.status] ?? v.status}
                        </div>
                        {v.etapa_desde && (
                          <div className="text-muted-foreground">
                            há {Math.max(0, diasEntre(v.etapa_desde.slice(0, 10), hoje))} dias nesta
                            etapa
                          </div>
                        )}
                        {pendenciasAndamento(v).map((p) => (
                          <div key={p} className="font-semibold text-red-700">
                            ⚠ {p}
                          </div>
                        ))}
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            O funil mostra todas as vendas abertas da equipe, de qualquer mês, e as concluídas
            assinadas no mês escolhido.
          </p>
        </CardContent>
      </Card>

      {/* BLOCO 5: recebimentos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Previsão de recebimentos do mês (parcelas com data neste mês)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-2">Data</th>
                <th className="p-2">Venda</th>
                <th className="p-2">Corretores da equipe</th>
                <th className="p-2 text-right">Parcela</th>
                <th className="p-2 text-right">Fração da equipe</th>
                <th className="p-2 text-right">Parte da equipe</th>
                <th className="p-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {receb.map((x) => {
                const atrasada = !x.recebido_em && (x.data ?? "") < hoje;
                return (
                  <tr key={`${x.sale_id}-${x.n}`} className="border-b">
                    <td className="p-2">{dt(x.data)}</td>
                    <td className="p-2">{x.codigo ?? "—"}</td>
                    <td className="p-2">{x.membros.map((n) => n.split(" ")[0]).join(", ")}</td>
                    <td className="p-2 text-right">{R(Number(x.valor ?? 0))}</td>
                    <td className="p-2 text-right">{Math.round(x.fracao * 100)}%</td>
                    <td className="p-2 text-right font-semibold">{R(x.parteEquipe)}</td>
                    <td className="p-2">
                      {x.recebido_em ? (
                        <Badge className="bg-green-100 text-green-700">recebida</Badge>
                      ) : atrasada ? (
                        <Badge className="bg-red-100 text-red-700">atrasada</Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700">a receber</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {receb.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-2 text-muted-foreground">
                    Nenhuma parcela com data neste mês.
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={5} className="p-2 font-semibold">
                  Total do mês
                </td>
                <td className="p-2 text-right font-semibold">{R(r.recebeEquipe)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* BLOCO 7: meta, dias sem vender, exclusivas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Meta do mês</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {metaValor > 0 ? (
              <>
                <div className="text-muted-foreground">
                  Comissão do pessoal: {R(r.comissaoPessoal)} de {R(metaValor)}
                </div>
                <div className="my-2 h-3 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-green-700" style={{ width: `${pct}%` }} />
                </div>
                <b>{pct.toFixed(0)}%</b>{" "}
                <span className="text-muted-foreground">
                  · faltam {R(Math.max(0, metaValor - r.comissaoPessoal))}
                </span>
              </>
            ) : (
              <div className="text-muted-foreground">
                Nenhuma meta de comissão cadastrada para esta equipe em {nomeMes(mes)}. A meta é
                cadastrada na tela Equipes.
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Há quantos dias sem vender</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {semVender.map((x) => {
                  const nivel = nivelSemVender(x.dias);
                  const cls =
                    nivel === "alerta"
                      ? "bg-red-100 text-red-700"
                      : nivel === "atencao"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700";
                  return (
                    <tr key={x.userId} className="border-b">
                      <td className="py-1">{x.nome}</td>
                      <td className="py-1 text-right">
                        <Badge className={cls}>
                          {x.dias == null ? "nunca vendeu" : `${x.dias} dias`}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Pela última assinatura. Amarelo acima de 14 dias, vermelho acima de 30.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">
              Captações exclusivas da equipe {exclusivas ? `(${exclusivas.length})` : ""}
            </CardTitle>
            {exclusivas != null && (
              <a
                href={`/exclusividades/painel?aba=por-corretor&equipe=${dados.equipe.id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver por corretor →
              </a>
            )}
          </CardHeader>
          <CardContent>
            {exclusivas == null ? (
              <div className="text-sm text-muted-foreground">
                O módulo de captação exclusiva está desligado nesta imobiliária.
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {exclusivas.map((e) => {
                    const vence = vencimentoExclusiva(e);
                    const d = vence ? diasEntre(hoje, vence) : null;
                    return (
                      <tr key={e.id} className="border-b">
                        <td className="py-1">
                          <a href={`/exclusividades/${e.id}`} className="hover:underline">
                            {[e.tipo, e.bairro].filter(Boolean).join(" — ") || "Captação"}
                          </a>
                          <div className="text-xs text-muted-foreground">
                            {nomePorId.get(e.captor_id) ?? "—"}
                          </div>
                        </td>
                        <td className="py-1 text-right">
                          {d != null && d <= 15 ? (
                            <Badge className="bg-red-100 text-red-700">
                              {d < 0 ? `venceu há ${-d} d` : `vence em ${d} d`}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">vence {dt(vence)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {exclusivas.length === 0 && (
                    <tr>
                      <td className="py-1 text-muted-foreground">
                        Nenhuma captação exclusiva ativa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <DetalhePessoa
        dados={dados}
        mes={mes}
        userId={pessoaAberta}
        onClose={() => setPessoaAberta(null)}
      />
    </>
  );
}

/** BLOCO 6: detalhe das vendas de um corretor no mês. */
function DetalhePessoa({
  dados,
  mes,
  userId,
  onClose,
}: {
  dados: PainelEquipeDados;
  mes: string;
  userId: string | null;
  onClose: () => void;
}) {
  const pontas = useMemo(() => pontasDoPainel(dados), [dados]);
  if (!userId) return null;
  const minhas = pontas.filter((p) => p.pessoaId === userId && mesDaData(p.concluidaEm) === mes);
  const membro = dados.membros.find((m) => m.user_id === userId);
  const nome = membro?.nome ?? minhas[0]?.pessoaNome ?? "—";
  const ganhoPorVenda = new Map(
    dados.ganhos
      .filter((g) => g.user_id === userId)
      .map((g) => [g.sale_id, Number(g.pessoal) || 0]),
  );
  const vistos = new Set<string>();
  const tot = minhas.reduce(
    (s, p) => {
      const g = vistos.has(p.saleId) ? 0 : (ganhoPorVenda.get(p.saleId) ?? 0);
      vistos.add(p.saleId);
      return { vgv: s.vgv + p.vgv, vgc: s.vgc + p.comissao, q: s.q + p.qtd, g: s.g + g };
    },
    { vgv: 0, vgc: 0, q: 0, g: 0 },
  );
  const abertas = dados.andamento.filter(
    (a) => a.status !== "ocorrencia_concluida" && a.membros.includes(userId),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {nome}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · {dados.equipe.nome} · {nomeMes(mes)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              ["VGV (parte dele)", R(tot.vgv)],
              ["VGC (parte dele)", R(tot.vgc)],
              ["Vendas", Q(tot.q)],
              ["Vai ganhar", R(tot.g)],
            ] as const
          ).map(([t, v]) => (
            <div key={t} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t}</div>
              <div className="text-lg font-bold">{v}</div>
            </div>
          ))}
        </div>
        <h3 className="mt-2 font-semibold">Vendas assinadas no mês</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="p-2">Assinatura</th>
                <th className="p-2">Venda</th>
                <th className="p-2">Papel dele</th>
                <th className="p-2">Com quem dividiu</th>
                <th className="p-2 text-right">Parte dele</th>
                <th className="p-2 text-right">VGV dele</th>
                <th className="p-2 text-right">VGC dele</th>
              </tr>
            </thead>
            <tbody>
              {minhas.map((p) => {
                const outros = pontas.filter((o) => o.saleId === p.saleId && o.pessoaId !== userId);
                const venda = dados.vendas.find((v) => v.sale_id === p.saleId);
                const externa = venda?.parceria_externa_captacao || venda?.parceria_externa_venda;
                return (
                  <tr key={`${p.saleId}-${p.tipo}`} className="border-b">
                    <td className="p-2">{dt(p.concluidaEm ? p.concluidaEm.slice(0, 10) : null)}</td>
                    <td className="p-2">
                      <a href={`/vendas/${p.saleId}`} className="font-semibold hover:underline">
                        {p.codigoInterno || p.imovelId || "—"}
                      </a>{" "}
                      {p.modalidade === "lancamento" && <Badge variant="outline">Lançamento</Badge>}
                    </td>
                    <td className="p-2">{p.tipo === "captacao" ? "captação" : "venda"}</td>
                    <td className="p-2">
                      {externa && <Badge variant="outline">imobiliária parceira</Badge>}
                      {outros.map((o) => (
                        <div key={`${o.pessoaId}-${o.tipo}`}>
                          {o.pessoaNome}{" "}
                          {o.teamId !== dados.equipe.id && (
                            <Badge className="bg-violet-100 text-violet-700">
                              {o.teamNome ?? "outra equipe / individual"}
                            </Badge>
                          )}
                        </div>
                      ))}
                      {!externa && outros.length === 0 && "—"}
                    </td>
                    <td className="p-2 text-right font-semibold">{Math.round(p.qtd * 100)}%</td>
                    <td className="p-2 text-right">{R(p.vgv)}</td>
                    <td className="p-2 text-right">{R(p.comissao)}</td>
                  </tr>
                );
              })}
              {minhas.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-2 text-muted-foreground">
                    Nenhuma venda assinada no mês.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {abertas.length > 0 && (
          <>
            <h3 className="mt-2 font-semibold">Em andamento (não entram nos números do mês)</h3>
            <table className="w-full text-sm">
              <tbody>
                {abertas.map((v) => (
                  <tr key={v.sale_id} className="border-b">
                    <td className="p-2">
                      <a href={`/vendas/${v.sale_id}`} className="font-semibold hover:underline">
                        {v.codigo ?? "—"}
                      </a>
                    </td>
                    <td className="p-2">{STATUS_LABEL[v.status] ?? v.status}</td>
                    <td className="p-2 text-red-700">
                      {pendenciasAndamento(v)
                        .map((x) => `⚠ ${x}`)
                        .join("  ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
