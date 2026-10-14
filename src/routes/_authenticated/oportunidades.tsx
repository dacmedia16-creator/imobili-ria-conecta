import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { guardOpportunitiesRoute } from "@/lib/oportunidades-module";
import {
  ageDays,
  ageLabel,
  ageTone,
  captureCandidate,
  captureMatches,
  faixaTexto,
  groupMatches,
  isExpired,
  pairKey,
  type AgeTone,
  type CaptureCandidate,
  type OpportunityKind,
  type OpportunityPost,
} from "@/lib/oportunidades";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { toast } from "sonner";
import { Radar, SearchX } from "lucide-react";

export const Route = createFileRoute("/_authenticated/oportunidades")({
  head: () => ({ meta: [{ title: "Oportunidades" }] }),
  beforeLoad: guardOpportunitiesRoute,
  component: OportunidadesPage,
});

// Tabelas/RPCs da migração 20261014120000 (ainda fora de types.ts).
const db = supabase as unknown as SupabaseClient;

const ABAS: { kind: OpportunityKind; label: string }[] = [
  { kind: "procura", label: "🔎 Procurando" },
  { kind: "oferta", label: "🏷️ Oferecendo" },
  { kind: "outros", label: "❔ Outros" },
];

const FAIXAS: { id: string; label: string; min: number; max: number }[] = [
  { id: "loc-ate-3k", label: "Locação até R$ 3 mil", min: 0, max: 3_000 },
  { id: "loc-3k", label: "Locação acima de R$ 3 mil", min: 3_000, max: 20_000 },
  { id: "ate-400k", label: "Até R$ 400 mil", min: 20_000, max: 400_000 },
  { id: "400-800k", label: "R$ 400 a 800 mil", min: 400_000, max: 800_000 },
  { id: "800k", label: "Acima de R$ 800 mil", min: 800_000, max: Number.MAX_SAFE_INTEGER },
];

/** Cor da borda por idade (verde hoje → cinza perto de vencer), como na maquete. */
const BORDA: Record<AgeTone, string> = {
  hoje: "border-l-[#1e9e4a]",
  recente: "border-l-[#7cc68f]",
  meio: "border-l-[#e6b400]",
  vencendo: "border-l-[#9aa3b5] opacity-80",
};

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

type PostRow = Omit<OpportunityPost, "valor_min" | "valor_max" | "valor"> & {
  valor_min: number | string | null;
  valor_max: number | string | null;
  valor: number | string | null;
};

const num = (v: number | string | null) => (v == null ? null : Number(v));
const valorRef = (p: OpportunityPost) => p.valor ?? p.valor_max ?? p.valor_min;

function OportunidadesPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<OpportunityPost[] | null>(null);
  const [captures, setCaptures] = useState<CaptureCandidate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [orgId, setOrgId] = useState<string | null>(null);
  const [aba, setAba] = useState<OpportunityKind>("procura");
  const [fTipo, setFTipo] = useState("");
  const [fFin, setFFin] = useState("");
  const [fBairro, setFBairro] = useState("");
  const [fValor, setFValor] = useState("");
  const [fCor, setFCor] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const desde = new Date(Date.now() - 9 * 86_400_000).toISOString();
      const [p, h, c, o] = await Promise.all([
        db
          .from("opportunity_posts")
          .select("id,kind,tipo,finalidade,bairro,valor_min,valor_max,valor,corretor,texto,posted_at")
          .gte("posted_at", desde)
          .order("posted_at", { ascending: false })
          .limit(500),
        db.from("opportunity_hidden_pairs").select("post_id,target_id"),
        db.rpc("opportunity_capture_candidates"),
        db.rpc("current_org_id"),
      ]);
      if (!alive) return;
      if (p.error) {
        toast.error(errorMessage(p.error, "Não foi possível carregar o mural."));
        setPosts([]);
        return;
      }
      setPosts(
        ((p.data ?? []) as PostRow[]).map((r) => ({
          ...r,
          valor_min: num(r.valor_min),
          valor_max: num(r.valor_max),
          valor: num(r.valor),
        })),
      );
      setHidden(
        new Set(((h.data ?? []) as { post_id: string; target_id: string }[]).map((x) => pairKey(x.post_id, x.target_id))),
      );
      // Sem captações (erro ou nenhuma aprovada) o mural continua funcionando, só sem o selo da equipe.
      setCaptures(c.error ? [] : ((c.data ?? []) as Parameters<typeof captureCandidate>[0][]).map(captureCandidate));
      setOrgId(typeof o.data === "string" ? o.data : null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const vivos = useMemo(() => (posts ?? []).filter((p) => !isExpired(p.posted_at)), [posts]);
  const grupo = useMemo(() => groupMatches(vivos, hidden), [vivos, hidden]);
  const equipe = useMemo(() => {
    const m = new Map<string, CaptureCandidate[]>();
    for (const { post, capture } of captureMatches(vivos, captures, hidden))
      m.set(post.id, [...(m.get(post.id) ?? []), capture]);
    return m;
  }, [vivos, captures, hidden]);

  const opcoes = (f: (p: OpportunityPost) => string | null) =>
    [...new Set(vivos.map(f).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const filtrados = useMemo(() => {
    const faixa = FAIXAS.find((f) => f.id === fValor);
    const q = busca.trim().toLowerCase();
    return vivos.filter((p) => {
      if (fTipo && p.tipo !== fTipo) return false;
      if (fFin && p.finalidade !== fFin) return false;
      if (fBairro && p.bairro !== fBairro) return false;
      if (fCor && p.corretor !== fCor) return false;
      if (faixa) {
        const v = valorRef(p);
        if (v == null || v < faixa.min || v > faixa.max) return false;
      }
      if (q && !`${p.texto} ${p.bairro ?? ""} ${p.corretor} ${p.tipo ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [vivos, fTipo, fFin, fBairro, fCor, fValor, busca]);

  const daAba = filtrados.filter((p) => p.kind === aba);
  const total = (k: OpportunityKind) => filtrados.filter((p) => p.kind === k).length;

  async function naoEncaixa(post: OpportunityPost, targetId: string) {
    if (!orgId || !user) return;
    const { error } = await db
      .from("opportunity_hidden_pairs")
      .insert({ organization_id: orgId, post_id: post.id, target_id: targetId, hidden_by: user.id });
    if (error) return toast.error(errorMessage(error, "Não foi possível ocultar o par."));
    setHidden((h) => new Set(h).add(pairKey(post.id, targetId)));
    toast.success("Par ocultado. Ele não aparece mais nem gera alerta.");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Radar}
        title="Oportunidades: mural do grupo"
        description="Posts do grupo de WhatsApp organizados automaticamente. Cada cartão some depois de 7 dias."
      />

      <div className="flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <Button
            key={a.kind}
            size="sm"
            variant={aba === a.kind ? "default" : "secondary"}
            className="rounded-full"
            onClick={() => setAba(a.kind)}
          >
            {a.label} <span className="ml-1 opacity-80">{posts ? total(a.kind) : ""}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-6">
          <Filtro label="Tipo">
            <select className={SELECT} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
              <option value="">Todos</option>
              {opcoes((p) => p.tipo).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Filtro>
          <Filtro label="Venda / locação">
            <select className={SELECT} value={fFin} onChange={(e) => setFFin(e.target.value)}>
              <option value="">Todas</option>
              <option>Venda</option>
              <option>Locação</option>
            </select>
          </Filtro>
          <Filtro label="Bairro / região">
            <select className={SELECT} value={fBairro} onChange={(e) => setFBairro(e.target.value)}>
              <option value="">Todos</option>
              {opcoes((p) => p.bairro).map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Filtro>
          <Filtro label="Faixa de valor">
            <select className={SELECT} value={fValor} onChange={(e) => setFValor(e.target.value)}>
              <option value="">Qualquer</option>
              {FAIXAS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Filtro>
          <Filtro label="Corretor">
            <select className={SELECT} value={fCor} onChange={(e) => setFCor(e.target.value)}>
              <option value="">Todos</option>
              {opcoes((p) => p.corretor).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Filtro>
          <Filtro label="Busca livre">
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="ex.: piscina, Airbnb" />
          </Filtro>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legenda cor="#1e9e4a" texto="Hoje" />
        <Legenda cor="#7cc68f" texto="1 a 2 dias" />
        <Legenda cor="#e6b400" texto="3 a 5 dias" />
        <Legenda cor="#9aa3b5" texto="6 a 7 dias (perto de vencer)" />
        <span>🤝 possível encaixe = procura × oferta do grupo</span>
        <span>⭐ encaixe com captação da equipe = procura × captação do ADM</span>
      </div>

      {posts === null ? (
        <ListSkeleton />
      ) : daAba.length === 0 ? (
        <EmptyState icon={SearchX}>Nenhum post nesta aba com os filtros atuais.</EmptyState>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {daAba.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              grupo={grupo.get(p.id) ?? []}
              equipe={equipe.get(p.id) ?? []}
              onNaoEncaixa={naoEncaixa}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Filtro({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cor }} />
      {texto}
    </span>
  );
}

function PostCard({
  post,
  grupo,
  equipe,
  onNaoEncaixa,
}: {
  post: OpportunityPost;
  grupo: OpportunityPost[];
  equipe: CaptureCandidate[];
  onNaoEncaixa: (post: OpportunityPost, targetId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const idade = ageDays(post.posted_at);
  const procura = post.kind === "procura";
  return (
    <Card className={`relative border-l-[6px] ${BORDA[ageTone(idade)]}`}>
      <CardContent className="space-y-1.5 p-3">
        <span className="absolute right-3 top-3 text-[11px] text-muted-foreground">{ageLabel(idade)}</span>
        <div className="flex flex-wrap gap-1.5 pr-20">
          {post.tipo && <Pill tom="slate">{post.tipo}</Pill>}
          {post.finalidade && <Pill tom={post.finalidade === "Venda" ? "blue" : "violet"}>{post.finalidade}</Pill>}
        </div>
        <h3 className="text-[15px] font-semibold">{post.bairro ?? "Região não informada"}</h3>
        <div className="text-xs text-muted-foreground">
          {faixaTexto(post)} · {post.corretor}
        </div>
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[12.5px] italic text-foreground/80">{post.texto}</p>
        {(grupo.length > 0 || equipe.length > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {grupo.length > 0 && (
              <button
                type="button"
                onClick={() => setAberto((x) => !x)}
                className="rounded-md border border-[#f1c86b] bg-[#fff1d6] px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]"
              >
                🤝 possível encaixe ({grupo.length})
              </button>
            )}
            {equipe.length > 0 && (
              <button
                type="button"
                onClick={() => setAberto((x) => !x)}
                className="rounded-md border border-[#f39aaa] bg-[#ffe3e8] px-2 py-0.5 text-[11px] font-semibold text-[#b0001f]"
              >
                ⭐ encaixe com captação da equipe ({equipe.length})
              </button>
            )}
          </div>
        )}
        {aberto && (
          <ul className="space-y-1 border-t pt-2 text-xs">
            {grupo.map((g) => (
              <Par
                key={g.id}
                texto={`🤝 ${g.kind === "oferta" ? "Oferta" : "Procura"} de ${g.corretor} · ${g.bairro ?? "—"} · ${faixaTexto(g)}`}
                // O par é sempre gravado como procura → alvo, para valer nos dois cartões.
                onNao={() => (procura ? onNaoEncaixa(post, g.id) : onNaoEncaixa(g, post.id))}
              />
            ))}
            {equipe.map((c) => (
              <Par
                key={c.id}
                texto={`⭐ Captação de ${c.captor_nome} · ${c.bairro ?? c.municipio ?? "—"}${c.valor ? ` · ${faixaTexto({ kind: "oferta", valor: c.valor, valor_min: null, valor_max: null })}` : ""}`}
                onNao={() => onNaoEncaixa(post, c.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Par({ texto, onNao }: { texto: string; onNao: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span>{texto}</span>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive" onClick={onNao}>
        🚫 Não encaixa
      </Button>
    </li>
  );
}
