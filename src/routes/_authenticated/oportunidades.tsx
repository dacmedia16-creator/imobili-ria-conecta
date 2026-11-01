import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { guardOpportunitiesRoute } from "@/lib/oportunidades-module";
import {
  faixaTexto,
  isExpired,
  pairKey,
  type EncaixeCaptacao,
  type EncaixesVisiveis,
  type OpportunityKind,
  type OpportunityPost,
} from "@/lib/oportunidades";
import { encaixesDoMural } from "@/lib/oportunidades-encaixes.functions";
import { contarPorAba, FAIXAS_VALOR, filtrarMural } from "@/lib/oportunidades-mural";
import { MuralPostCard } from "@/components/oportunidades/MuralPostCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/visual/base";
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

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const SELO = "rounded-md border px-2 py-0.5 text-[11px] font-semibold";
const SELO_GRUPO = `${SELO} border-[#f1c86b] bg-[#fff1d6] text-[#8a5a00]`;
const SELO_EQUIPE = `${SELO} border-emerald-300 bg-emerald-50 text-emerald-800`;

type PostRow = Omit<OpportunityPost, "valor_min" | "valor_max" | "valor"> & {
  valor_min: number | string | null;
  valor_max: number | string | null;
  valor: number | string | null;
};

const num = (v: number | string | null) => (v == null ? null : Number(v));

function OportunidadesPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<OpportunityPost[] | null>(null);
  // Encaixes calculados no servidor: cada um recebe só os pares de que faz parte (t_6dd4a31b).
  const [encaixes, setEncaixes] = useState<EncaixesVisiveis>({ grupo: {}, equipe: {} });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const buscarEncaixes = useServerFn(encaixesDoMural);
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
      const [p, e, o] = await Promise.all([
        db
          .from("opportunity_posts")
          .select(
            "id,kind,tipo,finalidade,bairro,valor_min,valor_max,valor,corretor,texto,posted_at",
          )
          .gte("posted_at", desde)
          .order("posted_at", { ascending: false })
          .limit(500),
        // Sem encaixes (erro) o mural continua funcionando, só sem os selos.
        buscarEncaixes().catch(() => null),
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
      if (e) setEncaixes(e);
      setOrgId(typeof o.data === "string" ? o.data : null);
    })();
    return () => {
      alive = false;
    };
  }, [buscarEncaixes]);

  // Validade de 7 dias: vencidos não entram em filtro, contagem nem encaixe.
  const vivos = useMemo(() => (posts ?? []).filter((p) => !isExpired(p.posted_at)), [posts]);
  // "Não encaixa" marcado agora some na hora, sem recarregar.
  const grupo = useMemo(() => {
    const porId = new Map(vivos.map((p) => [p.id, p]));
    const m = new Map<string, OpportunityPost[]>();
    for (const [id, alvos] of Object.entries(encaixes.grupo)) {
      const post = porId.get(id);
      if (!post) continue;
      const lista = alvos
        .map((a) => porId.get(a))
        .filter((g): g is OpportunityPost => Boolean(g))
        .filter(
          (g) => !hidden.has(post.kind === "procura" ? pairKey(id, g.id) : pairKey(g.id, id)),
        );
      if (lista.length) m.set(id, lista);
    }
    return m;
  }, [vivos, encaixes, hidden]);
  const equipe = useMemo(() => {
    const m = new Map<string, EncaixeCaptacao[]>();
    for (const [id, caps] of Object.entries(encaixes.equipe)) {
      const lista = caps.filter((c) => !hidden.has(pairKey(id, c.id)));
      if (lista.length) m.set(id, lista);
    }
    return m;
  }, [encaixes, hidden]);

  const opcoes = (f: (p: OpportunityPost) => string | null) =>
    [...new Set(vivos.map(f).filter((x): x is string => Boolean(x)))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

  const filtrados = useMemo(
    () =>
      filtrarMural(vivos, {
        tipo: fTipo,
        finalidade: fFin,
        bairro: fBairro,
        faixa: fValor,
        corretor: fCor,
        busca,
      }),
    [vivos, fTipo, fFin, fBairro, fCor, fValor, busca],
  );

  const daAba = filtrados.filter((p) => p.kind === aba);

  async function naoEncaixa(post: OpportunityPost, targetId: string) {
    if (!orgId || !user) return;
    const { error } = await db.from("opportunity_hidden_pairs").insert({
      organization_id: orgId,
      post_id: post.id,
      target_id: targetId,
      hidden_by: user.id,
    });
    if (error) return toast.error(errorMessage(error, "Não foi possível ocultar o par."));
    setHidden((h) => new Set(h).add(pairKey(post.id, targetId)));
    toast.success("Par ocultado. Ele não aparece mais nem gera alerta.");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Radar}
        title="Oportunidades"
        description="Posts do grupo de WhatsApp organizados automaticamente. Cada cartão some depois de 7 dias."
      />

      <div className="flex flex-wrap gap-1.5">
        {ABAS.map((a) => (
          <Button
            key={a.kind}
            size="sm"
            variant={aba === a.kind ? "default" : "secondary"}
            className="rounded-full px-3.5"
            onClick={() => setAba(a.kind)}
          >
            {a.label}{" "}
            <span className="ml-1">{posts ? `(${contarPorAba(filtrados, a.kind)})` : ""}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 xl:grid-cols-6">
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
              {FAIXAS_VALOR.map((f) => (
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
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="ex.: piscina, Airbnb"
            />
          </Filtro>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        <Legenda cor="#1e9e4a" texto="Hoje" />
        <Legenda cor="#7cc68f" texto="1 a 2 dias" />
        <Legenda cor="#e6b400" texto="3 a 5 dias" />
        <Legenda cor="#9aa3b5" texto="6 a 7 dias (perto de vencer)" />
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <span className={SELO_GRUPO}>🤝 possível encaixe</span> procura × oferta do grupo
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={SELO_EQUIPE}>⭐ encaixe com captação da equipe</span> procura × captação
          do ADM
        </span>
      </div>

      {posts === null ? (
        <ListSkeleton />
      ) : daAba.length === 0 ? (
        <EmptyState icon={SearchX}>Nenhum cartão com esses filtros.</EmptyState>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {daAba.map((p) => (
            <MuralPostCard
              key={p.id}
              post={p}
              encaixes={
                <Encaixes
                  post={p}
                  grupo={grupo.get(p.id) ?? []}
                  equipe={equipe.get(p.id) ?? []}
                  onNaoEncaixa={naoEncaixa}
                />
              }
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
      <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: cor }} />
      {texto}
    </span>
  );
}

/** Conteúdo do slot de encaixes do cartão: selos + lista com "não encaixa". */
function Encaixes({
  post,
  grupo,
  equipe,
  onNaoEncaixa,
}: {
  post: OpportunityPost;
  grupo: OpportunityPost[];
  equipe: EncaixeCaptacao[];
  onNaoEncaixa: (post: OpportunityPost, targetId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  if (grupo.length === 0 && equipe.length === 0) return null;
  const procura = post.kind === "procura";
  return (
    <>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {grupo.length > 0 && (
          <button type="button" onClick={() => setAberto((x) => !x)} className={SELO_GRUPO}>
            🤝 possível encaixe ({grupo.length})
          </button>
        )}
        {equipe.length > 0 && (
          <button type="button" onClick={() => setAberto((x) => !x)} className={SELO_EQUIPE}>
            ⭐ encaixe com captação da equipe ({equipe.length})
          </button>
        )}
      </div>
      {grupo.length > 0 && !aberto && (
        <div className="text-xs text-muted-foreground">
          ↳{" "}
          {grupo
            .map((g) => `${g.corretor} (${g.bairro ?? "—"}${g.valor ? `, ${faixaTexto(g)}` : ""})`)
            .join("; ")}
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
    </>
  );
}

function Par({ texto, onNao }: { texto: string; onNao: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span>{texto}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[11px] text-muted-foreground"
        onClick={onNao}
      >
        🚫 Não encaixa
      </Button>
    </li>
  );
}
