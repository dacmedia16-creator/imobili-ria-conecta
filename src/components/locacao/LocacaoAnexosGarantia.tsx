import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { anexarGarantiaLocacao, abrirAnexoLocacao } from "@/lib/locacao-db";
import { LocacaoArquivoAcoes } from "./LocacaoArquivoAcoes";
import { errorMessage } from "@/lib/errors";
import type { LocacaoDetalhe } from "@/lib/locacao";

/** Apólice/Termos podem chegar depois da assinatura. Sem apólice, o banco trava entregar chaves. */
export function LocacaoAnexosGarantia({
  d,
  editavel,
  recarregar,
}: {
  d: LocacaoDetalhe;
  editavel: boolean;
  recarregar: () => Promise<void>;
}) {
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tipo = d.garantia === "seguro_fianca" ? "apolice" : "loft_termos";
  const label = tipo === "apolice" ? "Apólice de seguro-fiança" : "Termos de garantia da Loft";
  if (d.garantia !== "seguro_fianca" && d.garantia !== "loft") return null;
  const anexar = async () => {
    const arquivo = input.current?.files?.[0];
    if (!arquivo) return;
    setBusy(true);
    try {
      await anexarGarantiaLocacao(d.id, tipo, arquivo, numero);
      await recarregar();
      setNumero("");
      if (input.current) input.current.value = "";
      toast.success("Anexo guardado na locação. A pendência de apólice foi atualizada.");
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível anexar."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="locacao-anexos-garantia">
      <h3 className="font-medium">{label}</h3>
      {d.apolicePendente && (
        <p
          role="alert"
          className="text-sm font-semibold text-amber-700"
          data-testid="apolice-pendente"
        >
          Apólice pendente — anexe para liberar a entrega de chaves.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        O contrato pode ser gerado e assinado sem número da apólice. O anexo pode chegar depois; sem
        ele, a entrega de chaves é recusada pelo sistema.
      </p>
      {d.anexos
        .filter((a) => a.tipo === tipo)
        .map((a) => (
          <div key={a.id} className="flex flex-wrap gap-2 text-sm">
            <Button
              variant="link"
              type="button"
              onClick={() =>
                void abrirAnexoLocacao(a.id).catch((e) =>
                  toast.error(errorMessage(e, "Anexo indisponível.")),
                )
              }
            >
              {a.nomeArquivo}
            </Button>
            <LocacaoArquivoAcoes tipo="anexo" id={a.id} nome={a.nomeArquivo} />
            <span>{a.numero ? `Nº ${a.numero}` : "Número não informado"}</span>
          </div>
        ))}
      {editavel && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            aria-label={`Número da ${label}`}
            placeholder="Número (opcional)"
            value={numero}
            maxLength={60}
            onChange={(e) => setNumero(e.target.value)}
            disabled={busy}
          />
          <Input
            aria-label={`Arquivo da ${label}`}
            ref={input}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
            disabled={busy}
          />
          <Button type="button" disabled={busy} onClick={() => void anexar()}>
            Anexar {tipo === "apolice" ? "apólice" : "termos"}
          </Button>
        </div>
      )}
    </section>
  );
}
