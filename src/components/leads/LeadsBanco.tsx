import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";
import { Paginacao } from "@/components/visual/Paginacao";
import { errorMessage } from "@/lib/errors";
import { ORIGEM_LABEL, type LeadBanco } from "@/lib/leads";
import { listarBanco, pegarLead } from "@/lib/leads-db";
import {
  ordenarBanco,
  paginar,
  POR_PAGINA_LEADS,
  resumoMensagem,
  tempoCurto,
} from "@/lib/telas-lote1";

/**
 * Banco "Leads da imobiliária" (P3). Qualquer corretor da imobiliária pega um lead para si;
 * o gestor redistribui abrindo o lead no painel. Telefone/e-mail só aparecem depois de pegar.
 * t_7bd432c2: linhas compactas, quem espera há mais tempo primeiro, mensagem recolhida e 25 por vez.
 * A lista vem da mesma RPC (lead_banco_listar): quem vê o banco continua sendo decidido no banco.
 */
export function LeadsBanco({
  podePegar,
  versao,
  onChanged,
  onTotal,
}: {
  podePegar: boolean;
  versao: number;
  onChanged: () => void;
  onTotal?: (n: number | null) => void;
}) {
  const [itens, setItens] = useState<LeadBanco[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);

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

  useEffect(() => {
    onTotal?.(itens ? itens.length : null);
  }, [itens, onTotal]);

  const ordenados = useMemo(() => ordenarBanco(itens ?? []), [itens]);
  const pag = paginar(ordenados, pagina, POR_PAGINA_LEADS);
  const agora = Date.now();

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
    <section className="space-y-3" aria-labelledby="banco-titulo">
      <div>
        <h2 id="banco-titulo" className="text-base font-semibold">
          Banco da imobiliária ({itens?.length ?? 0})
        </h2>
        <p className="text-xs text-muted-foreground">
          Leads sem dono: não foram aceitos a tempo ou ficaram sem atendimento. Quem espera há mais
          tempo aparece primeiro.
          {podePegar ? " Pegue um para você." : ""}
        </p>
      </div>
      {itens === null ? (
        <ListSkeleton rows={4} label="Carregando o banco de leads" />
      ) : itens.length === 0 ? (
        <EmptyState icon={Inbox}>Nenhum lead no banco agora.</EmptyState>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card" data-testid="banco-lista">
            {pag.itens.map((l) => {
              const espera = agora - new Date(l.no_banco_desde).getTime();
              const resumo = resumoMensagem(l.mensagem);
              return (
                <li
                  key={l.id}
                  className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  data-testid="banco-linha"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium">{l.nome}</span>
                      <Pill tom={espera >= 3 * 86_400_000 ? "red" : "amber"}>
                        No banco há {tempoCurto(espera)}
                      </Pill>
                      {l.simulado && <Pill tom="slate">Simulado</Pill>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ORIGEM_LABEL[l.origem]}
                      {l.com_imovel ? " · com imóvel" : ""}
                    </div>
                    {resumo && (
                      <details className="group mt-0.5 text-xs text-muted-foreground">
                        <summary className="cursor-pointer list-none truncate marker:hidden">
                          <span className="group-open:hidden">{resumo} · </span>
                          <span className="font-medium text-primary underline-offset-2 hover:underline">
                            <span className="group-open:hidden">ver mensagem</span>
                            <span className="hidden group-open:inline">ocultar mensagem</span>
                          </span>
                        </summary>
                        <p className="mt-1 whitespace-pre-line break-words rounded-md bg-muted/50 p-2">
                          {l.mensagem}
                        </p>
                      </details>
                    )}
                  </div>
                  {podePegar && (
                    <Button
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={busy !== null}
                      onClick={() => void pegar(l.id)}
                    >
                      {busy === l.id ? "Pegando…" : "Pegar para mim"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <Paginacao {...pag} rotulo="leads no banco" onIr={setPagina} />
        </>
      )}
    </section>
  );
}
