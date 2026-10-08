import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR, type Capture } from "@/lib/exclusive-captures";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { situacaoVendaLista, type SituacaoVendaLista } from "@/lib/exclusive-captures-db";
import { seloSituacaoCaptacao } from "@/lib/captacao-venda";
import {
  corDiasRestantes,
  COR_DIAS_STYLE,
  FASE_LABEL,
  FASE_STYLE,
  FILTROS_POR_CORRETOR_VAZIOS,
  linhaCaptacao,
  OPCOES_VENCE,
  passaFiltros,
  pessoasDaEquipe,
  resumoPorCorretor,
  textoDiasRestantes,
  totaisPorCorretor,
  type EstruturaEquipes,
  type Fase,
  type FiltrosPorCorretor,
} from "@/lib/exclusividades-por-corretor";
import type { PainelEquipeOpcao } from "@/lib/painel-equipe-calc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// painel_equipe_equipes ainda não consta do types.ts gerado.
const db = supabase as unknown as SupabaseClient;

function Campo({
  label,
  value,
  onChange,
  options,
  destaque,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  destaque?: boolean;
}) {
  return (
    <label
      className={`flex min-w-[9rem] flex-col gap-1 text-xs text-muted-foreground ${destaque ? "rounded-md outline-dashed outline-2 outline-offset-2 outline-violet-400" : ""}`}
    >
      {label}
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const zero = (n: number) => (n ? n : <span className="text-muted-foreground/50">0</span>);
const selo = (n: number, cls: string) =>
  n ? (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{n}</span>
  ) : (
    zero(0)
  );

/**
 * Aba "Por corretor" (maquete t_022158e9). `captures` = captações que o banco já liberou para quem
 * está logado; aqui só agrupamos. Gestor/TL/líder auxiliar: só a(s) equipe(s) que lideram.
 * Admin: escolhe a equipe. Nunca mostra proprietário nem comissão.
 */
export function PorCorretorTab({
  captures,
  today,
  isAdmin,
  equipeInicial,
  onEquipeChange,
}: {
  captures: Capture[];
  today: string;
  isAdmin: boolean;
  equipeInicial?: string;
  onEquipeChange?: (id: string) => void;
}) {
  const [equipes, setEquipes] = useState<PainelEquipeOpcao[] | null>(null);
  const [estrutura, setEstrutura] = useState<EstruturaEquipes | null>(null);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [vendas, setVendas] = useState<Map<string, SituacaoVendaLista>>(new Map());
  const [teamId, setTeamId] = useState<string>(equipeInicial ?? "");
  const [f, setF] = useState<FiltrosPorCorretor>(FILTROS_POR_CORRETOR_VAZIOS);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const [eq, teams, membros, coLideres, situacoes] = await Promise.all([
        db.rpc("painel_equipe_equipes"),
        supabase.from("teams").select("id, lider_id"),
        supabase.from("team_members").select("team_id, membro_id"),
        supabase.from("team_co_leaders").select("team_id, user_id"),
        situacaoVendaLista(),
      ]);
      if (cancelado) return;
      const lista = eq.error ? [] : ((eq.data ?? []) as PainelEquipeOpcao[]);
      setEquipes(lista);
      setVendas(situacoes);
      setEstrutura(
        teams.error || membros.error || coLideres.error
          ? null
          : {
              teams: (teams.data ?? []) as EstruturaEquipes["teams"],
              membros: (membros.data ?? []) as EstruturaEquipes["membros"],
              coLideres: (coLideres.data ?? []) as EstruturaEquipes["coLideres"],
            },
      );
      setTeamId((atual) =>
        atual && lista.some((e) => e.id === atual) ? atual : (lista[0]?.id ?? ""),
      );
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  const equipe = equipes?.find((e) => e.id === teamId) ?? null;
  const idsEquipe = useMemo(
    () => (equipe && estrutura ? pessoasDaEquipe(equipe.id, estrutura) : null),
    [equipe, estrutura],
  );

  // Nomes de quem está na equipe sem captação ainda (se o banco deixar ler o perfil).
  useEffect(() => {
    if (!idsEquipe?.size) return;
    let cancelado = false;
    void supabase
      .from("profiles")
      .select("id, nome, ativo")
      .in("id", [...idsEquipe])
      .then(({ data }) => {
        if (cancelado || !data) return;
        setNomes(
          new Map(
            (data as { id: string; nome: string | null; ativo: boolean | null }[])
              .filter((p) => p.ativo !== false && p.nome)
              .map((p) => [p.id, p.nome as string]),
          ),
        );
      });
    return () => {
      cancelado = true;
    };
  }, [idsEquipe]);

  const linhasEquipe = useMemo(() => {
    const ativas = captures.filter((c) => !c.archived_at);
    const daEquipe = idsEquipe ? ativas.filter((c) => idsEquipe.has(c.captor_id)) : ativas;
    return daEquipe.map((c) => linhaCaptacao(c, today));
  }, [captures, idsEquipe, today]);

  const pessoas = useMemo(() => {
    if (!idsEquipe) return undefined;
    const porId = new Map<string, string>();
    for (const id of idsEquipe) if (nomes.has(id)) porId.set(id, nomes.get(id) as string);
    for (const l of linhasEquipe)
      if (!porId.has(l.c.captor_id)) porId.set(l.c.captor_id, l.c.broker_name || "—");
    return [...porId]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [idsEquipe, nomes, linhasEquipe]);

  const filtradas = useMemo(
    () => linhasEquipe.filter((l) => passaFiltros(l, f)),
    [linhasEquipe, f],
  );
  const resumo = useMemo(() => {
    const base = resumoPorCorretor(filtradas, pessoas);
    return f.corretor ? base.filter((r) => r.id === f.corretor) : base;
  }, [filtradas, pessoas, f.corretor]);
  const t = useMemo(() => totaisPorCorretor(filtradas), [filtradas]);
  const bairros = useMemo(
    () => [...new Set(linhasEquipe.map((l) => l.bairro))].sort((a, b) => a.localeCompare(b)),
    [linhasEquipe],
  );

  if (equipes === null) return <p>Carregando…</p>;
  if (equipes.length === 0)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Você não lidera nenhuma equipe nesta imobiliária.
        </CardContent>
      </Card>
    );

  const mudarEquipe = (id: string) => {
    setTeamId(id);
    setAberto(null);
    setF(FILTROS_POR_CORRETOR_VAZIOS);
    onEquipeChange?.(id);
  };
  const set = (k: keyof FiltrosPorCorretor) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const mostraEquipe = isAdmin || equipes.length > 1;

  const kpi = (label: string, value: string | number) => (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            {mostraEquipe && (
              <Campo
                label={isAdmin ? "Equipe (só admin)" : "Equipe"}
                value={teamId}
                onChange={mudarEquipe}
                options={equipes.map((e) => [e.id, e.nome])}
                destaque={isAdmin}
              />
            )}
            <Campo
              label="Corretor"
              value={f.corretor}
              onChange={set("corretor")}
              options={[
                ["", "Todos da equipe"],
                ...(pessoas ?? []).map((p): [string, string] => [p.id, p.nome]),
              ]}
            />
            <Campo
              label="Status"
              value={f.fase}
              onChange={set("fase")}
              options={[
                ["", "Todos"],
                ...(Object.keys(FASE_LABEL) as Fase[]).map((k): [string, string] => [
                  k,
                  FASE_LABEL[k],
                ]),
              ]}
            />
            <Campo
              label="Vencendo em"
              value={f.vence}
              onChange={set("vence")}
              options={OPCOES_VENCE.map((o): [string, string] => [o.value, o.label])}
            />
            <Campo
              label="Bairro"
              value={f.bairro}
              onChange={set("bairro")}
              options={[["", "Todos"], ...bairros.map((b): [string, string] => [b, b])]}
            />
            <Button variant="outline" size="sm" onClick={() => setF(FILTROS_POR_CORRETOR_VAZIOS)}>
              Limpar filtros
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isAdmin
              ? `Admin: exibindo ${equipe?.nome ?? "—"}${equipe?.lider_nome ? ` (líder ${equipe.lider_nome})` : ""}.`
              : `Você vê só os corretores da ${equipe?.nome ?? "sua equipe"}.`}{" "}
            Dados do proprietário e comissão não aparecem aqui.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpi("Exclusivas em vigor", t.emVigor)}
        {kpi("Valor dos imóveis em vigor", brl(t.valorEmVigor))}
        {kpi("Vencem em até 30 dias", t.vencem30)}
        {kpi("Vencidas", t.vencidas)}
        {kpi("Aguardando gestor", t.aguardandoGestor)}
        {kpi("Em assinatura / rascunho", t.assinaturaOuRascunho)}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Resumo por corretor: clique no nome para ver as captações
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          <table className="w-full min-w-[720px]">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Corretor</th>
                <th className="text-right font-medium">Em vigor</th>
                <th className="text-right font-medium">Valor em vigor</th>
                <th className="text-right font-medium">Vencem em 30 dias</th>
                <th className="text-right font-medium">Vencidas</th>
                <th className="text-right font-medium">Aguard. gestor</th>
                <th className="text-right font-medium">Em assinatura</th>
                <th className="text-right font-medium">Rascunho / devolvida</th>
                <th className="text-right font-medium">Sem Plano de MKT</th>
              </tr>
            </thead>
            <tbody>
              {resumo.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-3 text-muted-foreground">
                    Nenhum corretor com captações nestes filtros.
                  </td>
                </tr>
              )}
              {resumo.map((r) => {
                const on = aberto === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`cursor-pointer border-b hover:bg-muted/50 ${on ? "bg-muted/50" : ""}`}
                      onClick={() => setAberto(on ? null : r.id)}
                    >
                      <td className="py-2 font-semibold">
                        {on ? "▾" : "▸"} {r.nome}
                      </td>
                      <td className="text-right">{zero(r.emVigor)}</td>
                      <td className="whitespace-nowrap text-right">
                        {r.emVigor ? brl(r.valorEmVigor) : "—"}
                      </td>
                      <td className="text-right">{selo(r.vencem30, "bg-red-100 text-red-800")}</td>
                      <td className="text-right">{selo(r.vencidas, "bg-red-100 text-red-800")}</td>
                      <td className="text-right">
                        {selo(r.aguardandoGestor, "bg-blue-100 text-blue-800")}
                      </td>
                      <td className="text-right">{zero(r.emAssinatura)}</td>
                      <td className="text-right">{zero(r.rascunho)}</td>
                      <td className="text-right">
                        {selo(r.semPlano, "bg-amber-100 text-amber-900")}
                      </td>
                    </tr>
                    {on && (
                      <tr>
                        <td colSpan={9} className="py-2">
                          <DetalheCorretor r={r} vendas={vendas} today={today} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Dias restantes:</span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />
              verde: mais de 60 dias
            </span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
              amarelo: de 30 a 60 dias
            </span>
            <span>
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />
              vermelho: menos de 30 dias ou vencida
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            “Valor em vigor” soma o valor do imóvel das exclusivas assinadas e ainda não vencidas
            {t.semValor > 0 ? ` (${t.semValor} sem valor preenchido não entram na soma)` : ""}. O
            fim é a data da assinatura + o prazo em dias do contrato.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DetalheCorretor({
  r,
  vendas,
  today,
}: {
  r: ReturnType<typeof resumoPorCorretor>[number];
  vendas: Map<string, SituacaoVendaLista>;
  today: string;
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <h3 className="mb-2 text-sm font-semibold">
        Captações de {r.nome} ({r.linhas.length})
      </h3>
      {r.linhas.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma captação com estes filtros.</p>
      ) : (
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 text-left font-medium">Endereço do imóvel</th>
              <th className="text-left font-medium">Bairro</th>
              <th className="text-left font-medium">Tipo</th>
              <th className="text-right font-medium">Valor</th>
              <th className="pl-3 text-left font-medium">Início</th>
              <th className="text-left font-medium">Fim</th>
              <th className="text-left font-medium">Dias restantes</th>
              <th className="text-left font-medium">Status</th>
              <th className="text-left font-medium">Plano de Marketing</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((l) => {
              const i = l.c.form_data.imovel;
              const endereco = [i?.endereco, i?.complemento].filter((x) => x?.trim()).join(" — ");
              const prazo = Number.parseInt(l.c.form_data.condicoes?.prazo_dias_numero ?? "", 10);
              const venda = vendas.get(l.c.id);
              const seloVenda = seloSituacaoCaptacao(venda?.situacao);
              return (
                <tr key={l.c.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">{endereco || "Sem endereço"}</td>
                  <td className="pr-2">{l.bairro}</td>
                  <td className="pr-2">{i?.tipo_imovel || "—"}</td>
                  <td className="whitespace-nowrap text-right">
                    {l.valor !== null ? brl(l.valor) : "—"}
                  </td>
                  <td className="whitespace-nowrap pl-3 pr-3">
                    {l.v ? formatDateBR(l.v.start) : "—"}
                  </td>
                  <td className="whitespace-nowrap pr-3">
                    {l.v ? (
                      formatDateBR(l.v.end)
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {prazo > 0 ? `${prazo} dias após assinar` : "após assinar"}
                      </span>
                    )}
                  </td>
                  <td>
                    {l.v ? (
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${COR_DIAS_STYLE[corDiasRestantes(l.v.daysLeft)]}`}
                      >
                        {textoDiasRestantes(l.v.daysLeft)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                          l.c.status === "devolvida"
                            ? "bg-amber-100 text-amber-900"
                            : FASE_STYLE[l.fase]
                        }`}
                      >
                        {l.c.status === "devolvida" ? "Devolvida p/ corrigir" : FASE_LABEL[l.fase]}
                      </span>
                      {seloVenda && (
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${seloVenda.classe}`}
                        >
                          {seloVenda.texto}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {l.plano ? (
                      <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        {l.plano} {l.plano === 1 ? "ação" : "ações"}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        ⚠ não definido
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/exclusividades/$id" params={{ id: l.c.id }}>
                        Abrir
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Prazo do contrato em dias, contado da data de assinatura. Antes de assinar, aparece só o
        prazo previsto. Proprietário, CPF, telefone e comissão não aparecem. Hoje:{" "}
        {formatDateBR(today)}.
      </p>
    </div>
  );
}
