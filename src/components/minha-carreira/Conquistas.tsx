import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Award, Medal, PartyPopper, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  normalizarClube,
  normalizarRanking,
  periodoRanking,
  progressoClube,
  textoFaixa,
  validarFaixas,
  type Clube,
  type Destaque,
  type Faixa,
  type LinhaRanking,
} from "@/lib/minha-carreira-conquistas";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";

// Minha carreira, PR 3 (card t_b848f957): bloco "Conquistas" — ranking da imobiliária, meus
// destaques do Mural e Clube RE/MAX. RPCs e tabela da migração 20261016140000 (fora de types.ts).
// O banco filtra pela imobiliária ativa e omite VGV/comissão de colegas com a chave desligada.
const db = supabase as unknown as SupabaseClient;

type Estado<T> = { data: T | null; error: string | null };
const CARREGANDO = { data: null, error: null };

export function Conquistas({ userId }: { userId: string }) {
  const hoje = useMemo(() => periodoAtual().hoje, []);
  const [aba, setAba] = useState<"mes" | "ano">("mes");
  const [rank, setRank] = useState<Estado<LinhaRanking[]>>(CARREGANDO);
  const [dest, setDest] = useState<Estado<Destaque[]>>(CARREGANDO);
  const [clube, setClube] = useState<Estado<Clube | null>>(CARREGANDO);

  useEffect(() => {
    let alive = true;
    setRank(CARREGANDO);
    const { inicio, fim } = periodoRanking(aba, hoje);
    db.rpc("carreira_ranking", { _inicio: inicio, _fim: fim }).then(({ data, error }) => {
      if (!alive) return;
      setRank(
        error
          ? { data: null, error: errorMessage(error, "Não foi possível carregar o ranking.") }
          : { data: normalizarRanking(data as Record<string, unknown>[]), error: null },
      );
    });
    return () => {
      alive = false;
    };
  }, [aba, hoje, userId]);

  const carregarClube = useCallback(async () => {
    const { data, error } = await db.rpc("carreira_clube", { _ano: null });
    setClube(
      error
        ? { data: null, error: errorMessage(error, "Não foi possível carregar o Clube RE/MAX.") }
        : {
            data: normalizarClube(
              (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null,
            ),
            error: null,
          },
    );
  }, []);

  useEffect(() => {
    let alive = true;
    db.rpc("carreira_meus_destaques", { _limit: 5 }).then(({ data, error }) => {
      if (!alive) return;
      setDest(
        error
          ? { data: null, error: errorMessage(error, "Não foi possível carregar os destaques.") }
          : { data: (data ?? []) as Destaque[], error: null },
      );
    });
    void carregarClube();
    return () => {
      alive = false;
    };
  }, [carregarClube, userId]);

  const valoresVisiveis = rank.data?.some((r) => r.valores_visiveis) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="h-5 w-5" aria-hidden /> Conquistas
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Ranking da imobiliária, seus destaques no Mural e o seu Clube RE/MAX.
        </p>
      </CardHeader>
      <CardContent className="space-y-6" data-testid="conquistas">
        <ClubeRemax estado={clube} onFaixasSalvas={carregarClube} />

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Medal className="h-4 w-4" aria-hidden /> Ranking
            </h3>
            <div className="flex gap-2" role="group" aria-label="Período do ranking">
              <Button
                size="sm"
                variant={aba === "mes" ? "default" : "outline"}
                onClick={() => setAba("mes")}
              >
                Mês
              </Button>
              <Button
                size="sm"
                variant={aba === "ano" ? "default" : "outline"}
                onClick={() => setAba("ano")}
              >
                Ano
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            1 ponto por captação vendida e 1 por venda.
            {rank.data && !valoresVisiveis
              ? " Nesta imobiliária os valores dos colegas não são exibidos; você vê só os seus."
              : ""}
          </p>
          {rank.error ? (
            <p className="text-sm text-destructive">{rank.error}</p>
          ) : !rank.data ? (
            <ListSkeleton />
          ) : rank.data.length === 0 ? (
            <EmptyState icon={Medal}>
              Ninguém pontuou neste período ainda. A primeira venda assinada abre o ranking.
            </EmptyState>
          ) : (
            <ol className="divide-y" data-testid="ranking">
              {rank.data.map((r) => (
                <li
                  key={r.user_id}
                  className={`flex flex-wrap items-center gap-2 py-2 ${r.eu ? "rounded-md bg-primary/5 px-2" : ""}`}
                >
                  <span className="w-7 text-sm font-semibold tabular-nums">{r.posicao}º</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {r.nome}
                    {r.eu ? <span className="text-muted-foreground"> (você)</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.captacoes} capt. · {r.vendas} vend.
                  </span>
                  <Pill tom={r.eu ? "violet" : "slate"}>{r.pontos} pts</Pill>
                  {r.vgv != null ? (
                    <span className="text-xs tabular-nums">
                      VGV {brl(r.vgv)}
                      {r.comissao != null ? ` · comissão ${brl(r.comissao)}` : ""}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PartyPopper className="h-4 w-4" aria-hidden /> Meus destaques no Mural
          </h3>
          {dest.error ? (
            <p className="text-sm text-destructive">{dest.error}</p>
          ) : !dest.data ? (
            <ListSkeleton />
          ) : dest.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Quando uma venda sua for celebrada no Mural de Conquistas, ela aparece aqui.
            </p>
          ) : (
            <ul className="divide-y" data-testid="meus-destaques">
              {dest.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Pill tom="green">{d.papel}</Pill>
                  <span className="min-w-0 flex-1 text-sm">
                    {d.tipo_imovel ?? "Imóvel"}
                    {d.bairro ? ` no ${d.bairro}` : ""}
                    {d.cidade ? `, ${d.cidade}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Assinada em {new Date(d.venda_em).toLocaleDateString("pt-BR")} ·{" "}
                    {Number(d.cheers)} parabéns
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ClubeRemax({
  estado,
  onFaixasSalvas,
}: {
  estado: Estado<Clube | null>;
  onFaixasSalvas: () => void;
}) {
  const { hasAny } = useAuth();
  const podeEditar = hasAny(["admin", "super_admin", "gestor"]);
  const [editando, setEditando] = useState(false);
  const c = estado.data;

  return (
    <section className="space-y-2" data-testid="clube-remax">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Award className="h-4 w-4" aria-hidden /> Clube RE/MAX
        </h3>
        {podeEditar ? (
          <Button size="sm" variant="outline" onClick={() => setEditando((x) => !x)}>
            {editando ? "Fechar faixas" : "Editar faixas"}
          </Button>
        ) : null}
      </div>
      {estado.error ? (
        <p className="text-sm text-destructive">{estado.error}</p>
      ) : estado.data === null && !estado.error && !editando ? (
        <ListSkeleton />
      ) : c ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Clube atual (VGC {c.ano - 1})</p>
              <p className="text-lg font-semibold">{c.clube_atual ?? "Ainda sem clube"}</p>
              <p className="text-xs text-muted-foreground">{brl(c.vgc_ano_anterior)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Buscando em {c.ano}</p>
              <p className="text-lg font-semibold">{c.clube_buscando ?? c.proximo_clube ?? "—"}</p>
              <p className="text-xs text-muted-foreground">VGC {brl(c.vgc_ano_corrente)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Falta para o próximo</p>
              <p className="text-lg font-semibold">
                {c.falta_proximo != null ? brl(c.falta_proximo) : "Clube máximo"}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.proximo_clube ? `até ${c.proximo_clube}` : "Parabéns!"}
              </p>
            </div>
          </div>
          {c.tabela_buscando != null ? (
            <>
              <div
                className="h-2 rounded-full bg-muted"
                aria-label={`${progressoClube(c).toFixed(0)}% até o próximo clube`}
              >
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${progressoClube(c)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {c.origem ?? `Tabela de referência ${c.tabela_buscando}`} · VGC = sua comissão nas
                vendas assinadas do ano.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              A imobiliária ainda não cadastrou as faixas do Clube RE/MAX.
            </p>
          )}
        </>
      ) : null}
      {podeEditar && editando ? (
        <EditorFaixas
          ano={c?.tabela_buscando ?? c?.ano ?? new Date().getFullYear()}
          onSalvo={onFaixasSalvas}
        />
      ) : null}
    </section>
  );
}

type LinhaForm = { nome: string; minimo: string };

function EditorFaixas({ ano: anoInicial, onSalvo }: { ano: number; onSalvo: () => void }) {
  const [ano, setAno] = useState(anoInicial);
  const [linhas, setLinhas] = useState<LinhaForm[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let alive = true;
    setLinhas(null);
    db.from("clube_remax_faixas")
      .select("id,ano,ordem,nome,vgc_minimo,origem")
      .eq("ano", ano)
      .order("ordem")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setErro(errorMessage(error, "Não foi possível carregar as faixas."));
          return;
        }
        setErro(null);
        setLinhas(
          ((data ?? []) as Faixa[]).map((f) => ({ nome: f.nome, minimo: String(f.vgc_minimo) })),
        );
      });
    return () => {
      alive = false;
    };
  }, [ano]);

  async function salvar() {
    if (!linhas) return;
    const faixas = linhas.map((l) => ({
      nome: l.nome.trim(),
      vgc_minimo: Number(l.minimo.replace(/\./g, "").replace(",", ".")),
    }));
    const msg = validarFaixas(faixas);
    if (msg) {
      toast.error(msg);
      return;
    }
    setSalvando(true);
    // Troca a tabela do ano inteira (apaga e regrava); RLS só permite a admin/gestor da imobiliária.
    // Se a regravação falhar, devolve as faixas antigas para o ano não ficar vazio.
    const del = await db
      .from("clube_remax_faixas")
      .delete()
      .eq("ano", ano)
      .select("ano,ordem,nome,vgc_minimo,origem");
    const ins = del.error
      ? del
      : await db.from("clube_remax_faixas").insert(
          faixas.map((f, i) => ({
            ano,
            ordem: i + 1,
            nome: f.nome,
            vgc_minimo: f.vgc_minimo,
            origem: `Tabela de referência ${ano}`,
          })),
        );
    if (ins.error && !del.error && del.data?.length) {
      await db.from("clube_remax_faixas").insert(del.data);
    }
    setSalvando(false);
    if (ins.error) {
      toast.error(errorMessage(ins.error, "Não foi possível salvar as faixas."));
      return;
    }
    toast.success(`Faixas de ${ano} salvas`);
    onSalvo();
  }

  const fmt = (n: number) => brl(n);
  const parsed = (linhas ?? []).map((l) => ({
    vgc_minimo: Number(l.minimo.replace(/\./g, "").replace(",", ".")) || 0,
  }));

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="editor-faixas">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Faixas do ano</span>
        <Input
          type="number"
          className="h-8 w-24"
          value={ano}
          onChange={(e) => setAno(Number(e.target.value) || anoInicial)}
          aria-label="Ano da tabela"
        />
        <span className="text-xs text-muted-foreground">
          Ano do clube; vale o VGC do ano anterior. Só gestor ou admin altera.
        </span>
      </div>
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !linhas ? (
        <ListSkeleton />
      ) : (
        <>
          {linhas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sem faixas para {ano}. Enquanto isso, vale a tabela mais recente.
            </p>
          ) : null}
          {linhas.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-40"
                value={l.nome}
                aria-label={`Nome da faixa ${i + 1}`}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))
                }
              />
              <Input
                className="h-8 w-36"
                inputMode="decimal"
                value={l.minimo}
                aria-label={`VGC mínimo da faixa ${i + 1}`}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, minimo: e.target.value } : x)))
                }
              />
              <span className="text-xs text-muted-foreground">{textoFaixa(parsed, i, fmt)}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
              >
                Remover
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLinhas([...linhas, { nome: "", minimo: "" }])}
            >
              Adicionar faixa
            </Button>
            <Button size="sm" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : `Salvar faixas de ${ano}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
