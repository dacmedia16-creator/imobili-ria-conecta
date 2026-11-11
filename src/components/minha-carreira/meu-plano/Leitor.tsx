import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, List, PencilLine, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/visual/base";
import {
  SECOES,
  TOTAL_PAGINAS,
  imagemPagina,
  secaoDaPagina,
  tituloPagina,
} from "@/lib/meu-plano-2027/book";
import {
  ORDEM,
  TRILHAS,
  exercicioDaPagina,
  rotuloPagina,
  statusTela,
  telaDaPagina,
  type Trilha,
} from "@/lib/meu-plano-2027/telas";
import type { Respostas } from "@/lib/meu-plano-2027/regras";

/** Selo do exercício da página (preenchida / em parte / exercício). */
export function SeloPagina({ id, S }: { id: string; S: Respostas }) {
  const s = statusTela(id, S);
  if (s === "ok") return <Pill tom="green">preenchida ✔</Pill>;
  if (s === "parc") return <Pill tom="amber">em parte</Pill>;
  if (s === "auto") return <Pill tom="blue">automática</Pill>;
  return <Pill tom="blue">✏️ exercício</Pill>;
}

/** Leitor das 56 páginas do book (imagens estáticas; só a página aberta é baixada + a próxima). */
export function Leitor({
  pagina,
  S,
  trilha,
  irPagina,
  preencher,
}: {
  pagina: number;
  S: Respostas;
  trilha: Trilha | null;
  irPagina: (n: number) => void;
  preencher: (id: string) => void;
}) {
  const n = Math.min(TOTAL_PAGINAS, Math.max(1, pagina));
  const [zoom, setZoom] = useState(false);
  const [indice, setIndice] = useState(false);
  const sec = secaoDaPagina(n);
  // Página com exercício próprio ou atalho para o exercício que está em outra tela (PDF 11 → Metas).
  const ex = telaDaPagina(n) ?? exercicioDaPagina(n);
  const atalho = !!ex && ex.pdf !== n;
  const naTrilha = ex && trilha ? ORDEM[trilha].includes(ex.id) : true;

  useEffect(() => {
    setZoom(false);
    window.scrollTo(0, 0);
    if (n < TOTAL_PAGINAS) {
      const img = new Image();
      img.src = imagemPagina(n + 1);
    }
  }, [n]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement?.tagName ?? "").toUpperCase()))
        return;
      if (e.key === "ArrowRight" && n < TOTAL_PAGINAS) irPagina(n + 1);
      if (e.key === "ArrowLeft" && n > 1) irPagina(n - 1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [n, irPagina]);

  return (
    <div className="-mx-4 space-y-0 sm:mx-0" data-testid="leitor-book">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <div className="min-w-0 flex-1 leading-tight">
          <b className="text-sm">{rotuloPagina(n)}</b>
          <span className="text-xs text-muted-foreground"> · de {TOTAL_PAGINAS} no PDF</span>
          <span className="block truncate text-xs text-muted-foreground">
            {sec.n} — {tituloPagina(n)}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setIndice((x) => !x)}
          aria-expanded={indice}
        >
          <List className="mr-1 h-4 w-4" aria-hidden /> Índice
        </Button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto bg-muted/60 px-3 py-2">
        {SECOES.map((s) => (
          <button
            key={s.de}
            type="button"
            onClick={() => irPagina(s.de)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs",
              s === sec ? "border-primary bg-primary text-primary-foreground" : "bg-background",
            )}
          >
            {s.n}
          </button>
        ))}
      </div>
      {indice ? (
        <div
          className="max-h-[60vh] overflow-y-auto border-b bg-card px-3 py-2"
          data-testid="indice-book"
        >
          {SECOES.map((s) => (
            <div key={s.de} className="pb-2">
              <p className="pt-2 text-xs font-semibold text-muted-foreground">
                {s.n} · PDF {s.de}–{s.ate}
              </p>
              {Array.from({ length: s.ate - s.de + 1 }, (_, i) => s.de + i).map((p) => {
                const t = telaDaPagina(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setIndice(false);
                      irPagina(p);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 border-b py-2 text-left text-sm last:border-0",
                      p === n && "bg-primary/10",
                    )}
                  >
                    <b className="w-16 shrink-0 text-xs text-primary">
                      {p > 1 ? `pág. ${p - 1}` : "capa"}
                      <span className="block font-normal text-muted-foreground">PDF {p}</span>
                    </b>
                    <span className="min-w-0 flex-1 truncate">{tituloPagina(p)}</span>
                    {t ? <SeloPagina id={t.id} S={S} /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
      {ex ? (
        <div className="flex flex-wrap items-center gap-2 bg-primary/10 px-3 py-2">
          <SeloPagina id={ex.id} S={S} />
          <Button
            size="sm"
            className="flex-1"
            onClick={() => preencher(ex.id)}
            data-testid="preencher-pagina"
          >
            <PencilLine className="mr-1 h-4 w-4" aria-hidden />{" "}
            {atalho ? `Ir ao exercício: ${ex.t}` : "Preencher esta página"}
          </Button>
          {atalho ? (
            <span className="basis-full text-xs text-muted-foreground">
              A frase desta página é montada na tela “{ex.t}” ({rotuloPagina(ex.pdf)}).
            </span>
          ) : null}
          {!naTrilha && trilha ? (
            <span className="basis-full text-xs text-muted-foreground">
              Esta página não faz parte da trilha {TRILHAS[trilha].n}; dá para preencher assim
              mesmo.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn("bg-zinc-800", zoom && "max-h-[75vh] overflow-auto")}>
        <img
          src={imagemPagina(n)}
          alt={`Página ${n} do book Agent Summit 2027`}
          width={900}
          height={1232}
          decoding="async"
          onDoubleClick={() => setZoom((z) => !z)}
          className={cn("block h-auto bg-white", zoom ? "w-[230%] max-w-none" : "w-full")}
          data-testid="pagina-book"
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        Aproxime com dois dedos ou toque duas vezes na página.
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setZoom((z) => !z)}>
          {zoom ? (
            <ZoomOut className="mr-1 h-4 w-4" aria-hidden />
          ) : (
            <ZoomIn className="mr-1 h-4 w-4" aria-hidden />
          )}
          {zoom ? "tamanho normal" : "ampliar"}
        </Button>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 border-t bg-background px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
        {ex ? (
          <Button
            className="h-12 w-full basis-full bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800"
            onClick={() => preencher(ex.id)}
            data-testid="preencher-pagina-fixo"
          >
            <PencilLine className="mr-2 h-5 w-5" aria-hidden />{" "}
            {atalho ? `Ir ao exercício: ${ex.t}` : "✏️ Preencher esta página"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="flex-1"
          disabled={n <= 1}
          onClick={() => irPagina(n - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Anterior
        </Button>
        <span className="self-center text-sm tabular-nums text-muted-foreground">
          {n}/{TOTAL_PAGINAS}
        </span>
        <Button
          className="flex-1"
          disabled={n >= TOTAL_PAGINAS}
          onClick={() => irPagina(n + 1)}
          data-testid="pagina-proxima"
        >
          Próxima <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** "🖼 ver página original": a imagem da página numa janela (só ilustração). */
export function PaginaOriginal({
  pdf,
  onFechar,
  abrirNoBook,
}: {
  pdf: number;
  onFechar: () => void;
  abrirNoBook: (n: number) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[120] overflow-auto bg-black/85 px-2 pb-6 pt-14"
      role="dialog"
      aria-modal="true"
      aria-label={`Página original do book, ${rotuloPagina(pdf)}`}
      onClick={(e) => e.target === e.currentTarget && onFechar()}
      data-testid="pagina-original"
    >
      <button
        type="button"
        onClick={onFechar}
        className="fixed right-2 top-[calc(0.5rem+env(safe-area-inset-top))] rounded-full bg-white px-4 py-2 text-sm font-bold text-black"
      >
        ✕ fechar
      </button>
      <p className="mb-2 text-center text-xs text-white">
        Página original do book ({rotuloPagina(pdf)}); só ilustração, não precisa preencher aqui.
      </p>
      <div className="mb-2 text-center">
        <Button size="sm" variant="secondary" onClick={() => abrirNoBook(pdf)}>
          📖 abrir no book
        </Button>
      </div>
      <img
        src={imagemPagina(pdf)}
        alt={`Página ${pdf} do book`}
        className="mx-auto block w-full max-w-[900px] rounded bg-white"
      />
    </div>
  );
}
