import { useState } from "react";
import { toast } from "sonner";
import { Download, Eye, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  VisualizadorDocumento,
  type DocumentoAberto,
} from "@/components/documentos/VisualizadorDocumento";
import { openDocumentPrintWindow, printDocumentUrls } from "@/lib/document-actions";
import { errorMessage } from "@/lib/errors";
import { linkArquivoLocacao } from "@/lib/locacao-db";

/** Link assinado com `download=` (o Storage responde como anexo: baixa em vez de abrir). */
function urlParaBaixar(url: string, nome: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(nome)}`;
}

function baixar(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = urlParaBaixar(url, nome);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Olho, imprimir e baixar de um arquivo da locação, iguais aos documentos de Vendas (t_7ed2403d).
 * Cada clique pede ao servidor um link assinado curto: o banco confere de novo quem pode ver.
 */
export function LocacaoArquivoAcoes({
  tipo,
  id,
  nome,
}: {
  tipo: "documento" | "anexo";
  id: string;
  nome: string;
}) {
  const [aberto, setAberto] = useState<DocumentoAberto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const falha = (e: unknown) => toast.error(errorMessage(e, "Documento indisponível."));

  const ver = async () => {
    setOcupado(true);
    try {
      setAberto({ nome, url: await linkArquivoLocacao(tipo, id) });
    } catch (e) {
      falha(e);
    } finally {
      setOcupado(false);
    }
  };
  const imprimir = () => {
    // Abre a janela ainda no clique (senão o navegador bloqueia) e só depois põe o link assinado.
    const janela = openDocumentPrintWindow();
    if (!janela) return;
    void linkArquivoLocacao(tipo, id)
      .then((url) => printDocumentUrls([{ file_name: nome, url }], janela))
      .catch((e: unknown) => {
        janela.close();
        falha(e);
      });
  };
  const baixarAgora = async () => {
    setOcupado(true);
    try {
      baixar(await linkArquivoLocacao(tipo, id), nome);
    } catch (e) {
      falha(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <span className="inline-flex items-center" data-testid="locacao-arquivo-acoes">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Visualizar"
          aria-label={`Visualizar ${nome}`}
          disabled={ocupado}
          onClick={() => void ver()}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Imprimir"
          aria-label={`Imprimir ${nome}`}
          onClick={imprimir}
        >
          <Printer className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Baixar"
          aria-label={`Baixar ${nome}`}
          disabled={ocupado}
          onClick={() => void baixarAgora()}
        >
          <Download className="h-4 w-4" />
        </Button>
      </span>
      <VisualizadorDocumento
        doc={aberto}
        onClose={() => setAberto(null)}
        onBaixar={(d) => baixar(d.url, d.nome)}
      />
    </>
  );
}
