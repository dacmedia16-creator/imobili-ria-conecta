import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Compass, Search } from "lucide-react";
import { TOUR_EVENTO_INICIAR } from "@/lib/tour-primeiro-acesso";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/visual/base";
import { WikiVideo } from "@/components/wiki/WikiVideo";
import { FAQ, GUIAS } from "@/lib/wiki-max/guias";
import {
  buscarGuias,
  guiasDoPapel,
  NOME_PAPEL,
  NOME_SISTEMA,
  papeisDaWiki,
  partesNegrito,
} from "@/lib/wiki-max/filtro";
import type { WikiGuia, WikiSistema } from "@/lib/wiki-max/tipos";

// Prints entram no bundle desta rota (só carregada depois do login, ssr: false do layout).
// Ficam em /assets com nome com hash; nenhuma página pública aponta para eles.
const PRINTS = import.meta.glob("/src/assets/wiki-max/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const urlDoPrint = (chave: string) => PRINTS[`/src/assets/wiki-max/${chave}.webp`];

export const Route = createFileRoute("/_authenticated/ajuda_/wiki")({
  head: () => ({ meta: [{ title: "Wiki MAX · Guias" }] }),
  component: WikiPage,
});

const ORDEM: WikiSistema[] = ["ger", "adm", "vis", "est"];
const COR: Record<WikiSistema, string> = {
  ger: "bg-muted text-foreground",
  adm: "bg-blue-100 text-blue-900",
  vis: "bg-emerald-100 text-emerald-900",
  est: "bg-red-100 text-red-900",
};

function Texto({ s }: { s: string }) {
  return (
    <>
      {partesNegrito(s).map((p, i) => (p.negrito ? <strong key={i}>{p.texto}</strong> : p.texto))}
    </>
  );
}

function SeloSistema({ s }: { s: WikiSistema }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COR[s]}`}>
      {NOME_SISTEMA[s]}
    </span>
  );
}

function Papeis({ g }: { g: WikiGuia }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>Quem vê:</span>
      {g.papeis.map((p) => (
        <span key={p} className="rounded-full border bg-muted/50 px-2 py-0.5 font-medium">
          {NOME_PAPEL[p]}
        </span>
      ))}
    </div>
  );
}

function Caixa({ tom, titulo, s }: { tom: string; titulo: string; s?: string }) {
  if (!s) return null;
  return (
    <div className={`rounded-lg border p-3 text-sm ${tom}`}>
      <strong>{titulo}</strong> <Texto s={s} />
    </div>
  );
}

function WikiPage() {
  const { roles } = useAuth();
  const papeis = useMemo(() => papeisDaWiki(roles), [roles]);
  const [todos, setTodos] = useState(false);
  const [termo, setTermo] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [verFaq, setVerFaq] = useState(false);

  const base = todos || papeis.length === 0 ? GUIAS : guiasDoPapel(GUIAS, papeis);
  const lista = buscarGuias(base, termo);
  const aberto = GUIAS.find((g) => g.id === abertoId) ?? null;

  const abrir = (id: string | null) => {
    setAbertoId(id);
    setVerFaq(false);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };

  return (
    <div className="space-y-6" data-testid="wiki-max">
      <PageHeader
        icon={BookOpen}
        title="Wiki MAX"
        description="Guias passo a passo do ADM MAX, do Visita MAX e do Estudo de Mercado MAX."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="ver-tour-de-novo"
              onClick={() => window.dispatchEvent(new Event(TOUR_EVENTO_INICIAR))}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
            >
              <Compass className="h-4 w-4" /> Ver tour de novo
            </button>
            <Link
              to="/ajuda"
              className="inline-flex items-center gap-1 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" /> Meus chamados
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar nos guias"
            placeholder="Busque: registrar venda, visita, estudo, não consigo entrar…"
            className="pl-9"
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value);
              setAbertoId(null);
              setVerFaq(false);
            }}
          />
        </div>
        {papeis.length > 0 && (
          <div className="flex rounded-lg border p-1 text-sm" role="group" aria-label="Quais guias">
            <button
              type="button"
              onClick={() => setTodos(false)}
              aria-pressed={!todos}
              className={`rounded-md px-3 py-1.5 ${!todos ? "bg-primary text-primary-foreground" : ""}`}
            >
              Para o meu papel
            </button>
            <button
              type="button"
              onClick={() => setTodos(true)}
              aria-pressed={todos}
              className={`rounded-md px-3 py-1.5 ${todos ? "bg-primary text-primary-foreground" : ""}`}
            >
              Todos os guias
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setVerFaq(true);
            setAbertoId(null);
          }}
          className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
        >
          ❓ Dúvidas frequentes
        </button>
      </div>

      {verFaq ? (
        <section className="space-y-2" data-testid="wiki-faq">
          <button type="button" className="text-sm text-primary" onClick={() => abrir(null)}>
            ← Voltar aos guias
          </button>
          <h2 className="text-lg font-semibold">Dúvidas frequentes</h2>
          {FAQ.map((f) => (
            <details key={f.pergunta} className="rounded-lg border bg-card p-3">
              <summary className="cursor-pointer font-medium">{f.pergunta}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{f.resposta}</p>
            </details>
          ))}
        </section>
      ) : aberto ? (
        <GuiaAberto g={aberto} lista={base} onAbrir={abrir} />
      ) : (
        <div className="space-y-6">
          {ORDEM.map((s) => {
            const doSistema = lista.filter((g) => g.sistema === s);
            if (!doSistema.length) return null;
            return (
              <section key={s} className="space-y-3">
                <h2 className="text-base font-semibold">
                  {s === "ger" ? "Primeiros passos" : NOME_SISTEMA[s]}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {doSistema.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => abrir(g.id)}
                      data-testid={`wiki-card-${g.id}`}
                      className="space-y-1 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary"
                    >
                      <div className="text-2xl" aria-hidden>
                        {g.icone}
                      </div>
                      <SeloSistema s={g.sistema} />
                      <div className="font-semibold">{g.titulo}</div>
                      <p className="text-sm text-muted-foreground">{g.resumo}</p>
                      <p className="text-xs text-muted-foreground">
                        👤 {g.papeis.map((p) => NOME_PAPEL[p]).join(" · ")}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          {lista.length === 0 && (
            <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Nada encontrado. Tente outra palavra ou abra um chamado em “Ajuda e sugestões”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GuiaAberto({
  g,
  lista,
  onAbrir,
}: {
  g: WikiGuia;
  lista: WikiGuia[];
  onAbrir: (id: string | null) => void;
}) {
  const i = lista.findIndex((x) => x.id === g.id);
  const prox = i >= 0 ? lista[i + 1] : undefined;
  return (
    <article
      className="max-w-3xl space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-7"
      data-testid={`wiki-guia-${g.id}`}
    >
      <button type="button" className="text-sm text-primary" onClick={() => onAbrir(null)}>
        ← Voltar aos guias
      </button>
      <div className="space-y-2">
        <SeloSistema s={g.sistema} />
        <h2 className="text-2xl font-semibold">
          <span aria-hidden>{g.icone}</span> {g.titulo}
        </h2>
        <p className="text-muted-foreground">{g.resumo}</p>
        <Papeis g={g} />
      </div>
      <Caixa tom="border-blue-200 bg-blue-50" titulo="📍 Onde fica:" s={g.onde} />
      <h3 className="font-semibold">Passo a passo</h3>
      <ol className="space-y-2">
        {g.passos.map((p, n) => (
          <li key={n} className="flex gap-3 border-b pb-2 text-sm last:border-b-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {n + 1}
            </span>
            <span>
              <Texto s={p} />
            </span>
          </li>
        ))}
      </ol>
      <Caixa tom="border-slate-200 bg-slate-50" titulo="👥 Outros papéis:" s={g.outrosPapeis} />
      {(g.videos ?? []).map((v) => (
        <WikiVideo
          key={`${g.id}-${v.chave}`}
          chave={v.chave}
          capaUrl={urlDoPrint(v.capa)}
          titulo={v.titulo}
          legenda={v.legenda}
          duracao={v.duracao}
        />
      ))}
      {(g.prints ?? []).map((p) => {
        const url = urlDoPrint(p.chave);
        if (!url) return null;
        return (
          <figure key={p.chave} className="space-y-1">
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={p.legenda} loading="lazy" className="w-full rounded-lg border" />
            </a>
            <figcaption className="text-xs text-muted-foreground">📸 {p.legenda}</figcaption>
          </figure>
        );
      })}
      <Caixa tom="border-emerald-200 bg-emerald-50" titulo="💡 Dica:" s={g.dica} />
      <Caixa tom="border-amber-300 bg-amber-50" titulo="⚠️ Cuidado:" s={g.cuidado} />
      <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
        <span className="text-muted-foreground">
          Não resolveu? Use o botão “Ajuda e sugestões” no topo da tela.
        </span>
        {prox && (
          <button
            type="button"
            onClick={() => onAbrir(prox.id)}
            className="ml-auto rounded-md bg-primary px-3 py-2 text-primary-foreground"
          >
            Próximo: {prox.titulo} →
          </button>
        )}
      </div>
    </article>
  );
}
