import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { NotebookPen, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  agruparPorDia,
  botoesDiario,
  contagem,
  diaMinimo,
  diaPermitido,
  inicioSemana,
  nomeAtividade,
  normalizarContagens,
  normalizarEquipe,
  normalizarRegistro,
  resumoDia,
  rotuloAtividade,
  type Contagens,
  type LinhaEquipeDiario,
  type RegistroDiario,
  type TipoHistorico,
} from "@/lib/minha-carreira-diario";
import { meuPlanoEnabled, planoDb } from "@/lib/meu-plano-2027/modulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import type { Respostas, TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { metasDoPlano, snapshotMudou } from "@/lib/meta-atividades";
import { ConvitePlano, EquipeMetas, QuadroSemana } from "./SuaSemana";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ListSkeleton } from "@/components/visual/base";

// Minha carreira, PR 5 (card t_2c0d5f0d): bloco "Diário de atividades" (ideia da Campolim na maquete:
// registrar ligação, visita e ACM com 1 toque). Sem pontos e fora do ranking (decisão de Denis, 16/10).
// Tabela e RPCs da migração 20261016190000 (fora de types.ts). O banco grava o registro em nome do
// usuário logado, na imobiliária ativa; o gestor/admin só lê o diário da equipe.
const db = supabase as unknown as SupabaseClient;

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

type PlanoSemana = { respostas: Respostas | null; padrao: TaxasFunil | null };

/** Plano 2027 do corretor (respostas) + taxas padrão da imobiliária. Só com o módulo ligado. */
async function lerPlano(userId: string): Promise<PlanoSemana> {
  const [p, t] = await Promise.all([
    planoDb
      .from("carreira_plano")
      .select("respostas")
      .eq("user_id", userId)
      .eq("ano", ANO_PLANO)
      .maybeSingle(),
    planoDb
      .from("carreira_taxas")
      .select("funil_v2_cre,funil_v1_v2,funil_folga")
      .is("user_id", null)
      .maybeSingle(),
  ]);
  const tx = t.data as Record<string, number | null> | null;
  const num = (v: number | null | undefined) => (v == null ? null : Number(v));
  return {
    respostas: ((p.data as { respostas?: Respostas } | null)?.respostas ??
      null) as Respostas | null,
    padrao: tx
      ? { v2cre: num(tx.funil_v2_cre), v1v2: num(tx.funil_v1_v2), folga: num(tx.funil_folga) }
      : null,
  };
}

export function Diario({ userId }: { userId: string }) {
  const { hasAny } = useAuth();
  const gestor = hasAny(["admin", "super_admin", "gestor"]);
  const tl = hasAny(["team_leader"]);
  const hoje = useMemo(() => periodoAtual().hoje, []);
  const [regs, setRegs] = useState<RegistroDiario[] | null>(null);
  const [linhasContagem, setLinhasContagem] = useState<Record<string, unknown>[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dia, setDia] = useState(hoje);
  const [qtd, setQtd] = useState(1);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [verEquipe, setVerEquipe] = useState(false);
  // null = ainda verificando o módulo Meu Plano 2027 (os botões só aparecem depois).
  const [novo, setNovo] = useState<boolean | null>(null);
  const [plano, setPlano] = useState<PlanoSemana | null>(null);

  // Módulo Meu Plano 2027 + plano do corretor. Recarrega ao voltar à aba (o plano pode ter mudado).
  const carregarPlano = useCallback(async () => {
    const on = await meuPlanoEnabled();
    setNovo(on);
    if (!on) return;
    const p = await lerPlano(userId);
    setPlano(p);
    // Guarda no plano a cópia das metas (campos ms.*) para o team leader, que não lê o plano.
    const metas = metasDoPlano(p.respostas, p.padrao);
    const dif = p.respostas ? snapshotMudou(p.respostas, metas) : {};
    if (Object.keys(dif).length)
      void planoDb.rpc("carreira_plano_salvar", { _ano: ANO_PLANO, _campos: dif });
  }, [userId]);

  useEffect(() => {
    void carregarPlano();
    const vis = () => document.visibilityState === "visible" && void carregarPlano();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [carregarPlano]);

  const contagens: Contagens | null = useMemo(
    () => (linhasContagem && novo !== null ? normalizarContagens(linhasContagem, novo) : null),
    [linhasContagem, novo],
  );
  const metas = useMemo(
    () => (plano ? metasDoPlano(plano.respostas, plano.padrao) : null),
    [plano],
  );

  const carregar = useCallback(async () => {
    const [r, c] = await Promise.all([
      // Só o próprio diário (o gestor também lê os da equipe pela RLS; aqui filtra o dele).
      db
        .from("carreira_diario")
        .select("id,user_id,dia,tipo,quantidade,created_at")
        .eq("user_id", userId)
        .gte("dia", diaMinimo(hoje))
        .order("dia", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500),
      db.rpc("meu_diario_contagens"),
    ]);
    const e = r.error ?? c.error;
    if (e) {
      setErro(errorMessage(e, "Não foi possível carregar o diário."));
      return;
    }
    setErro(null);
    setRegs(((r.data ?? []) as Record<string, unknown>[]).map(normalizarRegistro));
    setLinhasContagem((c.data as Record<string, unknown>[]) ?? []);
  }, [userId, hoje]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const dias = useMemo(() => (regs ? agruparPorDia(regs) : []), [regs]);
  const deHoje = dias.find((d) => d.dia === hoje);

  async function registrar(tipo: TipoHistorico) {
    if (!diaPermitido(dia, hoje)) {
      toast.error("Escolha um dia entre hoje e 31 dias atrás.");
      return;
    }
    const quantidade = Math.min(200, Math.max(1, Math.trunc(qtd) || 1));
    setEnviando(tipo);
    const { error } = await db.from("carreira_diario").insert({ tipo, quantidade, dia });
    setEnviando(null);
    if (error) {
      toast.error(errorMessage(error, "Não foi possível registrar a atividade."));
      return;
    }
    toast.success(`Registrado: ${quantidade} ${nomeAtividade(tipo, quantidade, novo ?? false)}`);
    setQtd(1);
    void carregar();
  }

  async function apagar(ids: string[], tipo: string, quantidade: number, d: string) {
    if (
      !window.confirm(
        `Apagar ${quantidade} ${nomeAtividade(tipo, quantidade, novo ?? false)} de ${dataBR(d)}?`,
      )
    )
      return;
    const { error } = await db.from("carreira_diario").delete().in("id", ids);
    if (error) {
      toast.error(errorMessage(error, "Não foi possível apagar."));
      return;
    }
    void carregar();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <NotebookPen className="h-5 w-5" aria-hidden /> Diário de atividades
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {novo
            ? "Registre ligações, V1, V2, ACMs e visitas com comprador com um toque. Só você e a gestão veem."
            : "Registre ligações, visitas e ACMs com um toque. Só você e a gestão veem."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="diario">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !regs || !contagens ? (
          <ListSkeleton />
        ) : (
          <>
            {novo ? (
              <section className="space-y-2" data-testid="sua-semana">
                <h3 className="text-sm font-semibold">Sua semana</h3>
                {metas ? (
                  <QuadroSemana
                    hoje={hoje}
                    metas={metas}
                    semana={{
                      ligacoes: contagem(contagens, "ligacao", "semana"),
                      v1: contagem(contagens, "v1", "semana"),
                      v2: contagem(contagens, "v2", "semana"),
                      acm: contagem(contagens, "acm", "semana"),
                      visitaComprador: contagem(contagens, "visita_comprador", "semana"),
                      captMes: contagens.captacao.mes,
                    }}
                    mes={{
                      ligacoes: contagem(contagens, "ligacao", "mes"),
                      v1: contagem(contagens, "v1", "mes"),
                      v2: contagem(contagens, "v2", "mes"),
                      acm: contagem(contagens, "acm", "mes"),
                      visitaComprador: contagem(contagens, "visita_comprador", "mes"),
                    }}
                  />
                ) : plano ? (
                  <ConvitePlano />
                ) : (
                  <ListSkeleton />
                )}
              </section>
            ) : null}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">Registrar</h3>
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={dia}
                  min={diaMinimo(hoje)}
                  max={hoje}
                  onChange={(e) => setDia(e.target.value || hoje)}
                  aria-label="Dia da atividade"
                />
                <Input
                  type="number"
                  className="h-8 w-20"
                  min={1}
                  max={200}
                  value={qtd}
                  onChange={(e) => setQtd(Number(e.target.value))}
                  aria-label="Quantidade"
                />
              </div>
              <div className="flex flex-wrap gap-2" data-testid="diario-botoes">
                {botoesDiario(!!novo).map((a) => (
                  <Button
                    key={a.tipo}
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-9 flex-col items-start gap-0 py-1.5 text-left"
                    disabled={enviando !== null || novo === null}
                    onClick={() => void registrar(a.tipo)}
                    data-testid={`registrar-${a.tipo}`}
                    title={a.dica}
                  >
                    <span className="inline-flex items-center">
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                      {a.rotulo}
                    </span>
                    {novo ? (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {a.dica}
                      </span>
                    ) : null}
                  </Button>
                ))}
              </div>
            </section>

            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="diario-contagens">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 text-left font-normal">Atividade</th>
                    <th className="py-1 text-right font-normal">Hoje</th>
                    <th className="py-1 text-right font-normal">Semana</th>
                    <th className="py-1 text-right font-normal">Mês</th>
                  </tr>
                </thead>
                <tbody>
                  {contagens.atividades.map((c) => (
                    <tr key={c.tipo} className="border-t" data-tipo={c.tipo}>
                      <td className="py-1">
                        {rotuloAtividade(c.tipo, !!novo)}
                        {novo && c.tipo === "visita" ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (fora das metas)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 text-right font-semibold tabular-nums">{c.hoje}</td>
                      <td className="py-1 text-right tabular-nums">{c.semana}</td>
                      <td className="py-1 text-right tabular-nums">{c.mes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">Hoje: </span>
              {resumoDia(deHoje, !!novo)}
            </p>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Histórico (últimos 31 dias)</h3>
              {dias.length === 0 ? (
                <EmptyState icon={NotebookPen}>
                  Nenhuma atividade ainda. Comece pela primeira ligação do dia.
                </EmptyState>
              ) : (
                <ul className="divide-y" data-testid="diario-historico">
                  {dias.map((d) => (
                    <li key={d.dia} className="space-y-1 py-2">
                      <span className="text-sm font-medium">
                        {d.dia === hoje ? "Hoje" : dataBR(d.dia)}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {d.itens.map((i) => (
                          <span
                            key={i.tipo}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                          >
                            {i.quantidade} {nomeAtividade(i.tipo, i.quantidade, !!novo)}
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Apagar ${nomeAtividade(i.tipo, i.quantidade, !!novo)} de ${dataBR(d.dia)}`}
                              onClick={() => void apagar(i.ids, i.tipo, i.quantidade, d.dia)}
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Com o Meu Plano ligado: gestor/admin e team leader veem feito x meta por corretor.
                Sem o módulo: o diário da equipe de antes (só gestor/admin). */}
            {novo ? (
              gestor || tl ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVerEquipe((v) => !v)}
                  data-testid="ver-equipe-metas"
                >
                  <Users className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {verEquipe ? "Ocultar equipe" : "Equipe: feito x meta"}
                </Button>
              ) : null
            ) : gestor ? (
              <Button size="sm" variant="outline" onClick={() => setVerEquipe((v) => !v)}>
                <Users className="mr-1 h-3.5 w-3.5" aria-hidden />
                {verEquipe ? "Ocultar equipe" : "Diário da equipe"}
              </Button>
            ) : null}
            {verEquipe && novo && (gestor || tl) ? (
              <EquipeMetas hoje={hoje} padrao={plano?.padrao ?? null} />
            ) : null}
            {verEquipe && !novo && gestor ? <EquipeDiario hoje={hoje} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EquipeDiario({ hoje }: { hoje: string }) {
  const [periodo, setPeriodo] = useState<"semana" | "mes">("semana");
  const [linhas, setLinhas] = useState<LinhaEquipeDiario[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLinhas(null);
    const inicio = periodo === "semana" ? inicioSemana(hoje) : periodoAtual().mes;
    db.rpc("carreira_diario_equipe", { _inicio: inicio, _fim: hoje }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErro(errorMessage(error, "Não foi possível carregar o diário da equipe."));
      else {
        setErro(null);
        setLinhas(normalizarEquipe(data as Record<string, unknown>[]));
      }
    });
    return () => {
      alive = false;
    };
  }, [periodo, hoje]);

  return (
    <section className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="diario-equipe">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Diário da equipe (só leitura)</span>
        <div className="flex gap-2" role="group" aria-label="Período da equipe">
          <Button
            size="sm"
            variant={periodo === "semana" ? "default" : "outline"}
            onClick={() => setPeriodo("semana")}
          >
            Semana
          </Button>
          <Button
            size="sm"
            variant={periodo === "mes" ? "default" : "outline"}
            onClick={() => setPeriodo("mes")}
          >
            Mês
          </Button>
        </div>
      </div>
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !linhas ? (
        <ListSkeleton />
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguém registrou atividades neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 text-left font-normal">Corretor</th>
                <th className="py-1 text-right font-normal">Ligações</th>
                <th className="py-1 text-right font-normal">Visitas</th>
                <th className="py-1 text-right font-normal">ACMs</th>
                <th className="py-1 text-right font-normal">Último registro</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.user_id} className="border-t">
                  <td className="py-1 font-medium">{l.nome}</td>
                  <td className="py-1 text-right tabular-nums">{l.ligacoes}</td>
                  <td className="py-1 text-right tabular-nums">{l.visitas}</td>
                  <td className="py-1 text-right tabular-nums">{l.acms}</td>
                  <td className="py-1 text-right text-xs text-muted-foreground">
                    {l.ultimo_dia ? dataBR(l.ultimo_dia) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
