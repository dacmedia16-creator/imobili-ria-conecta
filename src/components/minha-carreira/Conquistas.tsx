import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { PartyPopper, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import { periodoAtual } from "@/lib/minha-carreira";
import {
  textoFaixa,
  validarFaixas,
  type Destaque,
  type Faixa,
} from "@/lib/minha-carreira-conquistas";
import { RankingClubesPainel } from "@/components/ranking/RankingClubes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton, Pill } from "@/components/visual/base";

// Minha carreira › Conquistas: Clube RE/MAX + Ranking e Clubes (card t_481a3f26, RPC
// carreira_ranking_clubes) e meus destaques do Mural. Faixas em clube_remax_faixas (editáveis por
// gestor/admin). O banco filtra pela imobiliária ativa e omite a comissão de colegas quando não pode.
const db = supabase as unknown as SupabaseClient;

type Estado<T> = { data: T | null; error: string | null };
const CARREGANDO = { data: null, error: null };

export function Conquistas({ userId }: { userId: string }) {
  const [dest, setDest] = useState<Estado<Destaque[]>>(CARREGANDO);
  const [versao, setVersao] = useState(0);

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
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="h-5 w-5" aria-hidden /> Conquistas
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Seu Clube RE/MAX, o ranking da imobiliária e seus destaques no Mural.
        </p>
      </CardHeader>
      <CardContent className="space-y-6" data-testid="conquistas">
        <section className="space-y-2" data-testid="clube-remax">
          <EditarFaixas onFaixasSalvas={() => setVersao((v) => v + 1)} />
          <RankingClubesPainel key={versao} modo="corretor" userId={userId} />
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

/** Gestor/admin continuam editando as faixas do clube por ano (a tela do clube agora é o painel novo). */
function EditarFaixas({ onFaixasSalvas }: { onFaixasSalvas: () => void }) {
  const { hasAny } = useAuth();
  const podeEditar = hasAny(["admin", "super_admin", "gestor"]);
  const [editando, setEditando] = useState(false);
  const ano = useMemo(() => Number(periodoAtual().hoje.slice(0, 4)), []);
  if (!podeEditar) return null;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setEditando((x) => !x)}>
          {editando ? "Fechar faixas" : "Editar faixas"}
        </Button>
      </div>
      {editando ? <EditorFaixas ano={ano} onSalvo={onFaixasSalvas} /> : null}
    </div>
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
