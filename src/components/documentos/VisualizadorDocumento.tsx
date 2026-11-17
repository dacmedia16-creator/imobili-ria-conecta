import { useEffect, useState, type ReactNode } from "react";
import { Download, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaginasPdf } from "@/components/exclusividades/PaginasPdf";
import { useIsMobile } from "@/hooks/use-mobile";
import { isImageFile, printDocumentUrls } from "@/lib/document-actions";

export type DocumentoAberto = { nome: string; url: string };

/** "Baixar" igual ao de Vendas: abre o link assinado (curto) do bucket privado em outra aba. */
function baixarDocumentoAberto(url: string) {
  window.open(url, "_blank", "noopener");
}

/**
 * Janela de visualização de documento (olho) das Vendas, compartilhada com a Locação (t_7ed2403d).
 * Imagem com zoom; PDF no próprio leitor do navegador no computador e página por página no
 * celular (iframe de PDF fica em branco no Android). `url` é sempre link assinado do Storage.
 * `acoes` = botões extras do rodapé (ex.: Aprovar/Recusar da venda); `onBaixar` troca o "Baixar".
 */
export function VisualizadorDocumento({
  doc,
  onClose,
  acoes,
  onBaixar = (d) => baixarDocumentoAberto(d.url),
}: {
  doc: DocumentoAberto | null;
  onClose: () => void;
  acoes?: ReactNode;
  onBaixar?: (doc: DocumentoAberto) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const celular = useIsMobile();
  useEffect(() => setZoom(1), [doc?.url]);
  const imagem = !!doc && isImageFile(doc.nome);
  const zoomIn = () => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="visualizador-documento">
        <DialogHeader>
          <DialogTitle className="truncate">{doc?.nome}</DialogTitle>
        </DialogHeader>
        {imagem && (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="outline" onClick={zoomOut} disabled={zoom <= 0.5}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button size="sm" variant="outline" onClick={zoomIn} disabled={zoom >= 3}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            {zoom !== 1 && (
              <Button size="sm" variant="outline" onClick={() => setZoom(1)}>
                Redefinir
              </Button>
            )}
          </div>
        )}
        {doc && (
          <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/30">
            {imagem ? (
              <img
                src={doc.url}
                alt={doc.nome}
                className="mx-auto cursor-zoom-in select-none"
                style={
                  zoom === 1
                    ? { maxHeight: "70vh", maxWidth: "100%", width: "auto" }
                    : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }
                }
                onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
              />
            ) : celular ? (
              <PaginasPdf url={doc.url} nome={doc.nome} />
            ) : (
              <iframe src={doc.url} title={doc.nome} className="h-[70vh] w-full" />
            )}
          </div>
        )}
        <DialogFooter>
          {acoes}
          <Button
            variant="outline"
            onClick={() => doc && printDocumentUrls([{ file_name: doc.nome, url: doc.url }])}
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button variant="outline" onClick={() => doc && onBaixar(doc)}>
            <Download className="mr-2 h-4 w-4" />
            Baixar
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
