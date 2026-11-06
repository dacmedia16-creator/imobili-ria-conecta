import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { paginasPdfComoImagens } from "@/lib/pdf-paginas";

/**
 * Mostra um PDF página por página, como imagem (t_41c8f65a). Substitui o <iframe>, que no celular
 * fica em branco (Android) ou mostra só a 1ª página (iPhone). `url` = link assinado do Storage;
 * `bytes` = PDF montado no navegador (prévia).
 */
export function PaginasPdf({
  url,
  bytes,
  nome,
}: {
  url?: string;
  bytes?: Uint8Array;
  nome: string;
}) {
  const [estado, setEstado] = useState<
    | { fase: "carregando" }
    | { fase: "ok"; paginas: string[]; total: number; arquivo: string }
    | { fase: "erro"; motivo: string; arquivo: string | null }
  >({ fase: "carregando" });
  useEffect(() => {
    let vivo = true;
    let paginas: string[] = [];
    let arquivo: string | null = null;
    setEstado({ fase: "carregando" });
    void (async () => {
      try {
        let dados = bytes;
        if (!dados) {
          if (!url) throw new Error("Documento indisponível");
          const resp = await fetch(url);
          if (!resp.ok) throw new Error("Não foi possível baixar o PDF");
          dados = new Uint8Array(await resp.arrayBuffer());
        }
        arquivo = URL.createObjectURL(new Blob([dados as BlobPart], { type: "application/pdf" }));
        const r = await paginasPdfComoImagens(dados);
        paginas = r.urls;
        if (!vivo) return;
        setEstado({ fase: "ok", paginas: r.urls, total: r.total, arquivo });
      } catch (e: unknown) {
        if (!vivo) return;
        setEstado({
          fase: "erro",
          motivo: errorMessage(e, "Não foi possível mostrar o PDF"),
          arquivo: arquivo ?? url ?? null,
        });
      }
    })();
    return () => {
      vivo = false;
      paginas.forEach((p) => URL.revokeObjectURL(p));
      if (arquivo) URL.revokeObjectURL(arquivo);
    };
  }, [url, bytes]);
  const abrir = (href: string) => window.open(href, "_blank", "noopener");
  if (estado.fase === "carregando")
    return (
      <p className="p-4 text-sm text-muted-foreground" data-testid="pdf-paginas-carregando">
        Preparando as páginas do PDF…
      </p>
    );
  if (estado.fase === "erro")
    return (
      <div className="space-y-2 p-4 text-sm" data-testid="pdf-paginas-erro">
        <p className="text-amber-800">{estado.motivo}.</p>
        {estado.arquivo && (
          <Button variant="outline" size="sm" onClick={() => abrir(estado.arquivo!)}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Abrir o PDF em nova aba
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-3 p-2" data-testid="pdf-paginas">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {estado.total} {estado.total === 1 ? "página" : "páginas"}
          {estado.paginas.length < estado.total &&
            ` (mostrando ${estado.paginas.length}; abra em nova aba para ver todas)`}
        </span>
        <Button variant="ghost" size="sm" onClick={() => abrir(estado.arquivo)}>
          <ExternalLink className="mr-1 h-4 w-4" />
          Abrir em nova aba
        </Button>
      </div>
      {estado.paginas.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={`${nome} — página ${i + 1} de ${estado.total}`}
          className="mx-auto block w-full max-w-[820px] border bg-white shadow-sm"
          data-testid="pdf-pagina"
        />
      ))}
    </div>
  );
}
