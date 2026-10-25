import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import { ORIGEM_LABEL, type LeadBanco } from "@/lib/leads";
import { listarBanco, pegarLead } from "@/lib/leads-db";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/**
 * Banco "Leads da imobiliária" (P3). Qualquer corretor da imobiliária pega um lead para si;
 * o gestor redistribui abrindo o lead no painel. Telefone/e-mail só aparecem depois de pegar.
 */
export function LeadsBanco({
  podePegar,
  versao,
  onChanged,
}: {
  podePegar: boolean;
  versao: number;
  onChanged: () => void;
}) {
  const [itens, setItens] = useState<LeadBanco[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setItens(await listarBanco());
    } catch (e) {
      setItens([]);
      toast.error(errorMessage(e, "Não foi possível carregar o banco de leads."));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  const pegar = async (id: string) => {
    setBusy(id);
    try {
      await pegarLead(id);
      toast.success("Lead é seu. Ele já está em Meus leads.");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível pegar o lead."));
    } finally {
      setBusy(null);
      void carregar();
    }
  };

  return (
    <section className="space-y-2" aria-labelledby="banco-titulo">
      <h2 id="banco-titulo" className="text-base font-semibold">
        Leads da imobiliária ({itens?.length ?? 0})
      </h2>
      <p className="text-xs text-muted-foreground">
        Leads sem dono: não foram aceitos a tempo ou ficaram sem atendimento.
        {podePegar ? " Pegue um para você." : ""}
      </p>
      {itens && itens.length === 0 ? (
        <EmptyState icon={Inbox}>Nenhum lead no banco agora.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {(itens ?? []).map((l) => (
            <Card key={l.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="break-words font-medium">{l.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    {ORIGEM_LABEL[l.origem]} · no banco desde {dataCurta(l.no_banco_desde)}
                    {l.com_imovel ? " · com imóvel" : ""}
                  </div>
                  {l.mensagem && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {l.mensagem}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {l.simulado && <Pill tom="slate">Simulado</Pill>}
                  {podePegar && (
                    <Button size="sm" disabled={busy !== null} onClick={() => void pegar(l.id)}>
                      Pegar para mim
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
