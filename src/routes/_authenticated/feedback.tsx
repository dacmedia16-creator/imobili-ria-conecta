import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  diagnosis,
  groupByListing,
  ownerMessage,
  totalContacts,
  totalViews,
  whatsappLink,
  type ListingFeedback,
  type Snapshot,
} from "@/lib/owner-feedback";
import { errorMessage } from "@/lib/errors";
import { guardOwnerFeedbackRoute } from "@/lib/owner-feedback-module";
import { suggestOwnerRecommendation } from "@/lib/owner-feedback.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, Sparkles, TriangleAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/feedback")({
  head: () => ({ meta: [{ title: "Feedback ao proprietário" }] }),
  beforeLoad: guardOwnerFeedbackRoute,
  component: FeedbackPage,
});

const db = supabase as unknown as SupabaseClient;
const n = (x: number | null) => (x == null ? "—" : x.toLocaleString("pt-BR"));
const delta = (x: number | null) =>
  x == null ? "" : x > 0 ? ` (+${n(x)})` : x < 0 ? ` (${n(x)})` : "";

function FeedbackPage() {
  const { user, hasAny } = useAuth();
  const isManager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [broker, setBroker] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        // Últimas 3 coletas bastam para número atual + variação.
        const since = new Date(Date.now() - 22 * 864e5).toISOString().slice(0, 10);
        const all: Snapshot[] = [];
        for (let from = 0; ; from += 1000) {
          let q = db
            .from("portal_listing_snapshots")
            .select(
              "portal,collected_on,listing_code,broker_id,window_kind,window_from,window_to,impressions,views,contacts,error",
            )
            .gte("collected_on", since)
            .order("id")
            .range(from, from + 999);
          if (!isManager) q = q.eq("broker_id", user.id);
          const { data, error } = await q;
          if (error) throw error;
          all.push(...((data ?? []) as Snapshot[]));
          if (!data || data.length < 1000) break;
        }
        const ids = [...new Set(all.map((r) => r.broker_id).filter(Boolean))] as string[];
        const map: Record<string, string> = {};
        if (ids.length) {
          const { data } = await db.from("profiles").select("id,nome").in("id", ids);
          for (const p of data ?? []) map[p.id as string] = (p.nome as string) ?? "";
        }
        if (alive) {
          setRows(all);
          setNames(map);
        }
      } catch (e) {
        toast.error(errorMessage(e, "Não foi possível carregar os números dos portais."));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, isManager]);

  const listings = useMemo(() => groupByListing(rows), [rows]);
  const brokers = useMemo(
    () =>
      [...new Set(listings.map((l) => l.brokerId).filter(Boolean))]
        .map((id) => ({ id: id as string, nome: names[id as string] || "Sem nome" }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [listings, names],
  );
  const visible = listings.filter(
    (l) =>
      (!broker || (broker === "none" ? !l.brokerId : l.brokerId === broker)) &&
      (!search || l.code.includes(search.trim())),
  );
  const current = listings.find((l) => l.code === selected);

  if (current)
    return (
      <Review
        listing={current}
        brokerName={current.brokerId ? names[current.brokerId] : undefined}
        onBack={() => setSelected(null)}
      />
    );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Feedback ao proprietário</h1>
        <p className="text-sm text-muted-foreground">
          Números dos portais de cada imóvel, coletados automaticamente toda segunda. Escolha um
          imóvel, revise o texto e envie pelo seu WhatsApp.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 rounded-md border px-3 text-sm"
          placeholder="Buscar pelo código do anúncio"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isManager && (
          <select
            className="h-9 rounded-md border px-2 text-sm"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
          >
            <option value="">Todos os corretores</option>
            <option value="none">Sem corretor identificado</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !visible.length ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {isManager
              ? "Nenhum imóvel encontrado com esse filtro."
              : "Ainda não encontramos anúncios com o seu ID RE/MAX. Confira se o ID está preenchido em Meu perfil."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">{visible.length} imóveis</p>
          {visible.slice(0, 300).map((l) => (
            <button
              key={l.code}
              onClick={() => setSelected(l.code)}
              className="flex items-center justify-between rounded-lg border border-l-4 border-l-blue-500 bg-card p-3 text-left hover:bg-muted"
            >
              <div>
                <div className="font-medium">{l.code}</div>
                <div className="text-xs text-muted-foreground">
                  {isManager && (l.brokerId ? names[l.brokerId] || "Sem nome" : "Sem corretor")}
                  {isManager && " · "}
                  {l.lines.length} portal(is) · Sua vez: revisar e enviar
                </div>
              </div>
              <div className="text-right text-xs">
                <div>{n(totalViews(l))} visualizações</div>
                <div>{n(totalContacts(l))} contatos</div>
              </div>
            </button>
          ))}
          {visible.length > 300 && (
            <p className="text-xs text-muted-foreground">
              Mostrando 300 de {visible.length}. Use a busca ou o filtro.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Review({
  listing,
  brokerName,
  onBack,
}: {
  listing: ListingFeedback;
  brokerName?: string;
  onBack: () => void;
}) {
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [rec, setRec] = useState(() => diagnosis(listing));
  const [aiLoading, setAiLoading] = useState(false);
  const suggest = async () => {
    setAiLoading(true);
    try {
      const r = await suggestOwnerRecommendation({ data: { code: listing.code } });
      if (r.ok) {
        setRec(r.text);
        toast.success("Sugestão da IA pronta. Revise antes de enviar.");
      } else toast.error(r.error);
    } catch {
      toast.error("A IA não respondeu agora. Tente de novo em instantes.");
    } finally {
      setAiLoading(false);
    }
  };
  const text = ownerMessage({ ownerName, brokerName, listing, recommendation: rec });
  const anyConfirmed = listing.lines.some((l) => l.confirmed);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
      </Button>
      <h1 className="text-xl font-semibold">Imóvel {listing.code}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Números dos portais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {listing.lines.map((l) => (
            <div key={l.portal} className="rounded-md border p-2">
              <div className="font-medium">{l.label}</div>
              {l.error ? (
                <div className="text-amber-700">Sem atualização nesta semana.</div>
              ) : (
                <>
                  <div>
                    {n(l.views)} visualizações{delta(l.viewsDelta)} · {n(l.contacts)} contatos
                    {delta(l.contactsDelta)}
                    {l.impressions != null && ` · apareceu ${n(l.impressions)} vezes nas buscas`}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.periodText}
                    {!l.confirmed && " — não vai para o proprietário até confirmarmos o período"}
                  </div>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revisar e enviar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!anyConfirmed && (
            <div className="flex gap-2 rounded-md bg-amber-50 p-2 text-amber-800">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Este imóvel ainda não tem números com período confirmado. A mensagem sai sem números.
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <input
              className="h-9 rounded-md border px-3"
              placeholder="Nome do proprietário (opcional)"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
            <input
              className="h-9 rounded-md border px-3"
              placeholder="WhatsApp do proprietário (opcional)"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <label className="block">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Recomendação (pode editar)</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={aiLoading || !anyConfirmed}
                title={anyConfirmed ? undefined : "Sem números confirmados para a IA analisar"}
                onClick={suggest}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {aiLoading ? "Escrevendo..." : "Sugerir com IA"}
              </Button>
            </span>
            <textarea
              className="mt-1 min-h-20 w-full rounded-md border p-2"
              value={rec}
              onChange={(e) => setRec(e.target.value)}
            />
          </label>
          <div>
            <span className="text-xs text-muted-foreground">
              Prévia do que o proprietário recebe
            </span>
            <pre className="mt-1 whitespace-pre-wrap rounded-md border bg-muted p-3 font-sans">
              {text}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={whatsappLink(text, phone)} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-1 h-4 w-4" /> Enviar pelo meu WhatsApp
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(text).then(
                  () => toast.success("Texto copiado."),
                  () => toast.error("Não foi possível copiar."),
                )
              }
            >
              <Copy className="mr-1 h-4 w-4" /> Copiar texto
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
