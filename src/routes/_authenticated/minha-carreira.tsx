import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { exclusiveEnabled } from "@/lib/exclusive-captures-db";
import { opportunitiesEnabled } from "@/lib/oportunidades-module";
import {
  captureCandidate,
  faixaTexto,
  isExpired,
  pairKey,
  type CaptureCandidate,
  type OpportunityPost,
} from "@/lib/oportunidades";
import {
  PARADO_DIAS,
  PARADO_MIN_VIEWS,
  ROTULO_PENDENCIA,
  filtrarCaptacoes,
  oportunidadesParaMim,
  ordenarPendencias,
  textoDias,
  textoNumerosPortal,
  type MinhaCaptacao,
  type Pendencia,
  type PendenciaKind,
} from "@/lib/minha-carreira";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, PageHeader, Pill, type Tom } from "@/components/visual/base";
import { MeuMes } from "@/components/minha-carreira/MeuMes";
import { MeuDinheiro } from "@/components/minha-carreira/MeuDinheiro";
import { Conquistas } from "@/components/minha-carreira/Conquistas";
import { Diario } from "@/components/minha-carreira/Diario";
import { CheckCircle2, ListTodo, Radar, Sprout, Building2 } from "lucide-react";

// Minha carreira, PR 1 (card t_07d196a7): só leitura. Blocos 1 (O que fazer hoje), 4 (Minhas
// captações) e 5 (Oportunidades para mim). Tudo do corretor logado na imobiliária ativa: as RPCs
// filtram por auth.uid() e current_org_id() no banco; a tela não recebe dado de colega.
export const Route = createFileRoute("/_authenticated/minha-carreira")({
  head: () => ({ meta: [{ title: "Minha carreira" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session || !(await exclusiveEnabled())) throw redirect({ to: "/dashboard" });
  },
  component: MinhaCarreiraPage,
});

// RPCs da migração 20261016100000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

const TOM: Record<PendenciaKind, Tom> = {
  devolvida: "amber",
  vencendo: "amber",
  atrasada: "amber",
  documentos: "blue",
  sem_anuncio: "slate",
};

type PostRow = Omit<OpportunityPost, "valor_min" | "valor_max" | "valor"> & {
  valor_min: number | string | null;
  valor_max: number | string | null;
  valor: number | string | null;
};
const num = (v: number | string | null) => (v == null ? null : Number(v));

type Estado<T> = { data: T | null; error: string | null };
const CARREGANDO = { data: null, error: null };

function MinhaCarreiraPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [pend, setPend] = useState<Estado<Pendencia[]>>(CARREGANDO);
  const [caps, setCaps] = useState<Estado<MinhaCaptacao[]>>(CARREGANDO);
  const [opps, setOpps] = useState<
    Estado<{ post: OpportunityPost; capture: CaptureCandidate }[]> & { off?: boolean }
  >(CARREGANDO);
  const [soParadas, setSoParadas] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    db.rpc("minhas_pendencias").then(({ data, error }) => {
      if (!alive) return;
      setPend(
        error
          ? { data: null, error: errorMessage(error, "Não foi possível carregar as pendências.") }
          : { data: (data ?? []) as Pendencia[], error: null },
      );
    });
    db.rpc("minhas_captacoes", { _dias: PARADO_DIAS, _min_views: PARADO_MIN_VIEWS }).then(
      ({ data, error }) => {
        if (!alive) return;
        setCaps(
          error
            ? { data: null, error: errorMessage(error, "Não foi possível carregar as captações.") }
            : { data: (data ?? []) as MinhaCaptacao[], error: null },
        );
      },
    );
    (async () => {
      if (!(await opportunitiesEnabled())) {
        if (alive) setOpps({ data: [], error: null, off: true });
        return;
      }
      const desde = new Date(Date.now() - 9 * 86_400_000).toISOString();
      const [p, h, c] = await Promise.all([
        db
          .from("opportunity_posts")
          .select(
            "id,kind,tipo,finalidade,bairro,valor_min,valor_max,valor,corretor,texto,posted_at",
          )
          .eq("kind", "procura")
          .gte("posted_at", desde)
          .order("posted_at", { ascending: false })
          .limit(500),
        db.from("opportunity_hidden_pairs").select("post_id,target_id"),
        db.rpc("opportunity_capture_candidates"),
      ]);
      if (!alive) return;
      const erro = p.error ?? c.error;
      if (erro) {
        setOpps({
          data: null,
          error: errorMessage(erro, "Não foi possível carregar as oportunidades."),
        });
        return;
      }
      const posts = ((p.data ?? []) as PostRow[])
        .map((r) => ({
          ...r,
          valor_min: num(r.valor_min),
          valor_max: num(r.valor_max),
          valor: num(r.valor),
        }))
        .filter((x) => !isExpired(x.posted_at));
      const hidden = new Set(
        ((h.data ?? []) as { post_id: string; target_id: string }[]).map((x) =>
          pairKey(x.post_id, x.target_id),
        ),
      );
      const captures = ((c.data ?? []) as Parameters<typeof captureCandidate>[0][]).map(
        captureCandidate,
      );
      setOpps({ data: oportunidadesParaMim(posts, captures, hidden, userId), error: null });
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const pendencias = useMemo(() => (pend.data ? ordenarPendencias(pend.data) : null), [pend.data]);
  const captacoes = useMemo(
    () => (caps.data ? filtrarCaptacoes(caps.data, soParadas) : null),
    [caps.data, soParadas],
  );
  const paradas = caps.data?.filter((c) => c.parado === true).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Sprout}
        title="Minha carreira"
        description="Só o que é seu: pendências, captações e pedidos que encaixam nos seus imóveis."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListTodo className="h-5 w-5" aria-hidden /> O que fazer hoje
          </CardTitle>
          <p className="text-sm text-muted-foreground">Da mais urgente para a menos urgente.</p>
        </CardHeader>
        <CardContent>
          {pend.error ? (
            <p className="text-sm text-destructive">{pend.error}</p>
          ) : !pendencias ? (
            <ListSkeleton />
          ) : pendencias.length === 0 ? (
            <EmptyState icon={CheckCircle2}>Nenhuma pendência. Tudo em dia.</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="minhas-pendencias">
              {pendencias.map((p, i) => (
                <li
                  key={`${p.kind}-${p.capture_id}-${i}`}
                  className="flex flex-wrap items-center gap-2 py-2.5"
                >
                  <Pill tom={TOM[p.kind]}>{ROTULO_PENDENCIA[p.kind]}</Pill>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.detalhe}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.imovel ?? "Imóvel sem descrição"}
                      {textoDias(p) ? ` · ${textoDias(p)}` : ""}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/exclusividades/$id" params={{ id: p.capture_id }}>
                      Abrir
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {userId ? <MeuMes userId={userId} /> : null}

      {userId ? <MeuDinheiro userId={userId} /> : null}

      {userId ? <Conquistas userId={userId} /> : null}

      {userId ? <Diario userId={userId} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5" aria-hidden /> Minhas captações
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Últimos {PARADO_DIAS} dias nos portais. “Parado” = menos de {PARADO_MIN_VIEWS}{" "}
            visualizações e nenhum contato no período.
          </p>
          <div className="flex gap-2 pt-1" role="group" aria-label="Filtro de captações">
            <Button
              size="sm"
              variant={soParadas ? "outline" : "default"}
              onClick={() => setSoParadas(false)}
            >
              Todas
            </Button>
            <Button
              size="sm"
              variant={soParadas ? "default" : "outline"}
              onClick={() => setSoParadas(true)}
            >
              Só paradas ({paradas})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {caps.error ? (
            <p className="text-sm text-destructive">{caps.error}</p>
          ) : !captacoes ? (
            <ListSkeleton />
          ) : captacoes.length === 0 ? (
            soParadas ? (
              <EmptyState>Nenhum imóvel parado.</EmptyState>
            ) : (
              // A rota só abre com o módulo de captação ligado (beforeLoad), então o botão
              // aparece apenas quando o módulo está ativo.
              <EmptyState
                icon={Building2}
                action={
                  <Button asChild size="sm">
                    <Link to="/exclusividades">Nova captação</Link>
                  </Button>
                }
              >
                Cadastre sua primeira captação exclusiva.
              </EmptyState>
            )
          ) : (
            <ul className="divide-y" data-testid="minhas-captacoes">
              {captacoes.map((c) => (
                <li key={c.capture_id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {c.imovel ?? "Imóvel sem descrição"}
                      {c.listing_code ? (
                        <span className="text-muted-foreground"> · {c.listing_code}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {textoNumerosPortal(c)}
                      {c.dias_restantes != null
                        ? c.dias_restantes < 0
                          ? ` · exclusividade vencida há ${-c.dias_restantes} dias`
                          : ` · exclusividade: faltam ${c.dias_restantes} dias`
                        : ""}
                    </p>
                  </div>
                  {c.status !== "aprovada" ? (
                    <Pill tom={c.status === "devolvida" ? "amber" : "slate"}>
                      {c.status === "devolvida"
                        ? "Devolvida"
                        : c.status === "rascunho"
                          ? "Rascunho"
                          : "Em análise"}
                    </Pill>
                  ) : c.parado === true ? (
                    <Pill tom="red">Parado</Pill>
                  ) : c.parado === false ? (
                    <Pill tom="green">Com movimento</Pill>
                  ) : (
                    <Pill tom="slate">Sem dado</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Radar className="h-5 w-5" aria-hidden /> Oportunidades para mim
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Pedidos de clientes do grupo que encaixam nas suas captações.
          </p>
        </CardHeader>
        <CardContent>
          {opps.off ? (
            <p className="text-sm text-muted-foreground">
              O módulo Oportunidades não está ligado nesta imobiliária.
            </p>
          ) : opps.error ? (
            <p className="text-sm text-destructive">{opps.error}</p>
          ) : !opps.data ? (
            <ListSkeleton />
          ) : opps.data.length === 0 ? (
            <EmptyState icon={Radar}>
              {caps.data && caps.data.length === 0
                ? "As oportunidades aparecem aqui quando você tiver captações: mostramos os pedidos de clientes do grupo que encaixam nos seus imóveis."
                : "Nenhum pedido encaixa nas suas captações agora."}
            </EmptyState>
          ) : (
            <ul className="divide-y" data-testid="minhas-oportunidades">
              {opps.data.slice(0, 10).map(({ post, capture }) => (
                <li key={`${post.id}-${capture.id}`} className="py-2.5">
                  <p className="text-sm font-medium">
                    {post.corretor} procura {post.tipo ?? "imóvel"}
                    {post.bairro ? ` no ${post.bairro}` : ""} · {faixaTexto(post)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Encaixa na sua captação: {capture.tipo ?? "imóvel"}
                    {capture.bairro ? ` — ${capture.bairro}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {opps.data && opps.data.length > 0 ? (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link to="/oportunidades">Ver no mural</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
