import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { partesParaLink, type ParteLink } from "@/lib/locacao-links";
import { emitirLinkLocacao } from "@/lib/locacao-links.functions";

export type StatusLink = {
  modo: "cliente" | "corretor";
  links: { parte: ParteLink; status: string; expira_em: string; enviado_em: string | null }[];
};
const nome: Record<ParteLink, string> = {
  proprietario: "Proprietário",
  locatario: "Locatário",
  fiador: "Fiador",
};
const descricao: Record<string, string> = {
  nao_aberto: "não aberto",
  em_preenchimento: "em preenchimento",
  enviado: "enviado",
};

export function LocacaoLinks({
  id,
  garantia,
  editavel,
  onStatus,
}: {
  id: string;
  garantia: string;
  editavel: boolean;
  onStatus?: (s: StatusLink) => void;
}) {
  const [estado, setEstado] = useState<StatusLink | null>(null);
  const [links, setLinks] = useState<Partial<Record<ParteLink, string>>>({});
  const [busy, setBusy] = useState(false);
  const partes = partesParaLink(garantia);
  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "locacao_links_lista" as never,
      { _id: id } as never,
    );
    if (error) throw new Error(error.message);
    const s = data as unknown as StatusLink;
    setEstado(s);
    onStatus?.(s);
  }, [id, onStatus]);
  useEffect(() => {
    void ler().catch(() => toast.error("Não foi possível ler os convites."));
  }, [ler]);
  const agir = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível atualizar os convites."));
    } finally {
      setBusy(false);
    }
  };
  const modo = (m: "cliente" | "corretor") =>
    void agir(async () => {
      const { error } = await supabase.rpc(
        "locacao_links_modo" as never,
        { _id: id, _modo: m } as never,
      );
      if (error) throw new Error(error.message);
      setLinks({});
      await ler();
      toast.success(
        m === "cliente"
          ? "Clientes podem preencher por link"
          : "Corretor preenche; convites cancelados",
      );
    });
  const emitir = (p: ParteLink) =>
    void agir(async () => {
      const r = await emitirLinkLocacao({ data: { locacaoId: id, parte: p } });
      const url = `${window.location.origin}/locacao-link/${r.token}`;
      setLinks((v) => ({ ...v, [p]: url }));
      await ler();
      toast.success(`Novo link de ${nome[p]} criado. O anterior não vale mais.`);
    });
  return (
    <Card data-testid="locacao-cliente-preenche">
      <CardHeader>
        <CardTitle className="text-base">Quem preenche a documentação?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={estado?.modo !== "cliente" ? "default" : "outline"}
            disabled={!editavel || busy}
            onClick={() => modo("corretor")}
          >
            A) Eu preencho
          </Button>
          <Button
            type="button"
            variant={estado?.modo === "cliente" ? "default" : "outline"}
            disabled={!editavel || busy}
            onClick={() => modo("cliente")}
          >
            B) Cliente preenche
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void agir(ler)}>
            Atualizar status
          </Button>
        </div>
        {estado?.modo === "cliente" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cada pessoa recebe apenas o seu formulário. Link válido por 7 dias; gerar outro
              cancela o anterior. Depois do envio, o corretor confere e envia à gestão.
            </p>
            {partes.map((p) => {
              const s = estado.links.find((l) => l.parte === p);
              const url = links[p];
              const texto = `Olá! Preencha seus dados e anexe os documentos da locação por este link individual (válido por 7 dias): ${url}`;
              return (
                <div key={p} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>{nome[p]}</b>
                    <span>
                      {s ? (descricao[s.status] ?? s.status) : "sem link"}
                      {s && s.status !== "enviado" && new Date(s.expira_em) < new Date()
                        ? " · vencido"
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!editavel || busy}
                      onClick={() => emitir(p)}
                    >
                      {s ? "Gerar novo link" : "Gerar link"}
                    </Button>
                    {url && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(url)
                              .then(() => toast.success("Link copiado"))
                              .catch(() => toast.error("Não foi possível copiar."))
                          }
                        >
                          Copiar link
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              `https://wa.me/?text=${encodeURIComponent(texto)}`,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          Abrir WhatsApp
                        </Button>
                      </>
                    )}
                  </div>
                  {s && !url && s.status !== "enviado" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Por segurança o link não fica salvo em claro. Para reenviar, gere outro e
                      copie ou abra o WhatsApp.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
