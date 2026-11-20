import { useState } from "react";
import { toast } from "sonner";
import { FileUp, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocacaoArquivoAcoes } from "@/components/locacao/LocacaoArquivoAcoes";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarFinalLocacao,
  prepararFinalLocacao,
  registrarFinalLocacao,
} from "@/lib/locacao-finais.functions";
import { errorMessage } from "@/lib/errors";
import { dataBr, type LocacaoDetalhe } from "@/lib/locacao";

const LABEL: Record<"contrato_locacao" | "contrato_adm" | "laudo", string> = {
  contrato_locacao: "Contrato de locação assinado",
  contrato_adm: "Contrato de administração assinado",
  laudo: "Laudo de vistoria assinado",
};
const M = 16 * 1024 * 1024;

export function LocacaoDocumentosFinais({
  d,
  contratos,
  vistoria,
  recarregar,
}: {
  d: LocacaoDetalhe;
  contratos: boolean;
  vistoria: boolean;
  recarregar: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  if (!d.finaisPode) return null;
  const disponiveis = (["contrato_locacao", "contrato_adm", "laudo"] as const).filter((t) =>
    t === "laudo" ? vistoria || (contratos && d.assinatura.vistJunto) : contratos,
  );
  const guardar = async (tipo: keyof typeof LABEL, arquivo: File | undefined) => {
    if (!arquivo) return;
    if (
      arquivo.type !== "application/pdf" ||
      !/\.pdf$/i.test(arquivo.name) ||
      arquivo.size > M ||
      arquivo.size < 5
    ) {
      toast.error("Envie um PDF de até 16 MB.");
      return;
    }
    setOcupado(true);
    try {
      const { path, token } = await prepararFinalLocacao({ data: { locacaoId: d.id, tipo } });
      const { error } = await supabase.storage
        .from("locacao-documentos")
        .uploadToSignedUrl(path, token, arquivo, { contentType: "application/pdf" });
      if (error) throw new Error(error.message);
      const reg = await registrarFinalLocacao({
        data: {
          locacaoId: d.id,
          tipo,
          path,
          nome: arquivo.name.slice(0, 200),
        },
      });
      toast.success(
        reg.repetido
          ? "Este arquivo já estava guardado; não será enviado de novo."
          : "PDF guardado na locação.",
      );
      await recarregar();
      if (reg.envio?.desligado)
        toast.info("Envio automático de documentos desligado; PDF guardado para consulta.");
      else if (reg.envio?.falhas)
        toast.warning("PDF guardado; confira no histórico os envios que não saíram.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível guardar o documento."));
    } finally {
      setOcupado(false);
    }
  };
  const reenviar = async (
    doc: LocacaoDetalhe["finais"][number],
    destinatario: "locatario" | "proprietario",
  ) => {
    setOcupado(true);
    try {
      const res = await enviarFinalLocacao({
        data: { documentoId: doc.id, origem: "reenvio", destinatario },
      });
      if (res.desligado)
        toast.info("O envio de documentos está desligado até o teste e liberação.");
      else if (res.enviados) toast.success("Envio solicitado e registrado.");
      else
        toast.warning(
          "Nada enviado. Confira o telefone e o histórico abaixo; aguarde 2 minutos entre reenvios.",
        );
      await recarregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível reenviar o documento."));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Card data-testid="locacao-documentos-finais">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documentos finais</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          PDFs assinados guardados nesta locação. Só o corretor responsável e as equipes autorizadas
          podem visualizar e baixar.
        </p>
        {disponiveis.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {disponiveis.map((tipo) => (
              <label
                key={tipo}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-xs hover:bg-muted"
              >
                <FileUp className="h-4 w-4" /> Anexar {LABEL[tipo].toLowerCase()}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  disabled={ocupado}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void guardar(tipo, file);
                  }}
                />
              </label>
            ))}
          </div>
        )}
        {d.finais.length === 0 && (
          <p className="text-muted-foreground">Nenhum PDF assinado anexado ainda.</p>
        )}
        {d.finais.map((f) => (
          <div
            key={f.id}
            className="rounded-md border p-3 space-y-2"
            data-testid="locacao-final-arquivo"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <b>{LABEL[f.tipo]}</b>
                <br />
                <span className="break-all text-xs text-muted-foreground">
                  {f.nomeArquivo} · {dataBr(f.enviadoEm)} · {f.enviadoPorNome ?? "Equipe"}
                </span>
              </div>
              <LocacaoArquivoAcoes tipo="final" id={f.id} nome={f.nomeArquivo} />
            </div>
            <div className="flex flex-wrap gap-2">
              {(["locatario", "proprietario"] as const)
                .filter((dest) => f.tipo !== "contrato_adm" || dest === "proprietario")
                .map((dest) => (
                  <Button
                    key={dest}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={ocupado || !d.finaisTel?.[dest]}
                    onClick={() => void reenviar(f, dest)}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" /> Reenviar ao{" "}
                    {dest === "locatario" ? "locatário" : "proprietário"}
                  </Button>
                ))}
            </div>
            {((!d.finaisTel?.locatario && f.tipo !== "contrato_adm") ||
              !d.finaisTel?.proprietario) && (
              <p role="status" className="text-amber-700 dark:text-amber-300">
                Telefone não cadastrado ou inválido:{" "}
                {[
                  !d.finaisTel?.locatario && f.tipo !== "contrato_adm" ? "locatário" : "",
                  !d.finaisTel?.proprietario ? "proprietário" : "",
                ]
                  .filter(Boolean)
                  .join(" e ")}
                . Não será enviado a esse destinatário.
              </p>
            )}
            {f.envios.length > 0 && (
              <div className="space-y-1 text-xs" aria-label="Histórico de envios">
                {f.envios.map((e) => (
                  <p key={e.id}>
                    {dataBr(e.criadoEm)} · {e.origem === "auto" ? "automático" : "reenvio"} ao{" "}
                    {e.destinatario}
                    {e.telefoneFinal ? ` (final ${e.telefoneFinal})` : ""} · <b>{e.status}</b>
                    {e.solicitadoPorNome ? ` · por ${e.solicitadoPorNome}` : ""}
                    {e.erro ? ` · ${e.erro}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
