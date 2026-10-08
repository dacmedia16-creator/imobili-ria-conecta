// "Virou venda": na venda aberta a partir de uma captação, mostra a origem e os documentos da
// captação SEM copiá-los. O banco só devolve a lista (e só libera o arquivo) para quem já pode ver
// a venda, com a venda ativa, e nunca o contrato "gerado" sem assinatura.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ExternalLink, Link2 } from "lucide-react";
import {
  abrirDocumentoHerdado,
  documentosDaCaptacaoNaVenda,
  type DocumentoHerdado,
} from "@/lib/exclusive-captures-db";
import { rotuloDocumentoHerdado } from "@/lib/captacao-venda";
import { errorMessage } from "@/lib/errors";

export function VendaOrigemCaptacao({
  saleId,
  captureId,
}: {
  saleId: string;
  captureId: string | null | undefined;
}) {
  const [docs, setDocs] = useState<DocumentoHerdado[]>([]);
  useEffect(() => {
    if (!captureId) return;
    let vivo = true;
    documentosDaCaptacaoNaVenda(saleId)
      .then((d) => vivo && setDocs(d))
      .catch(() => vivo && setDocs([]));
    return () => {
      vivo = false;
    };
  }, [saleId, captureId]);
  if (!captureId) return null;
  const codigo = captureId.slice(0, 8).toUpperCase();
  const abrir = async (doc: DocumentoHerdado) => {
    // Abre a aba já no clique (evita bloqueio de pop-up) e só depois põe a URL assinada.
    const aba = window.open("", "_blank");
    try {
      const url = await abrirDocumentoHerdado(doc);
      if (aba) aba.location.href = url;
      else window.location.href = url;
    } catch (e: unknown) {
      aba?.close();
      toast.error(errorMessage(e, "Não foi possível abrir o documento"));
    }
  };
  return (
    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 print:hidden">
      <p className="flex flex-wrap items-center gap-1">
        <Link2 className="h-4 w-4" />
        <strong>Origem: captação exclusiva #{codigo}.</strong>
        <Link
          to="/exclusividades/$id"
          params={{ id: captureId }}
          className="inline-flex items-center gap-1 underline"
        >
          Abrir captação <ExternalLink className="h-3 w-3" />
        </Link>
      </p>
      {docs.length > 0 ? (
        <>
          <p className="mt-1 text-xs">
            Documentos vindos da captação: não foram copiados, a venda aponta para os mesmos
            arquivos.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="rounded-full border border-blue-300 bg-white px-3 py-1 text-xs font-medium hover:bg-blue-100"
                  onClick={() => abrir(d)}
                  title={d.file_name}
                >
                  {rotuloDocumentoHerdado(d.kind, d.owner_index)}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-xs">
          Documentos da captação indisponíveis aqui (venda encerrada ou sem acesso).
        </p>
      )}
    </div>
  );
}
