import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { FilePlus2, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import { formatBRLOu } from "@/lib/formato-moeda";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { SITUACAO_LABEL } from "@/lib/proposta-compra";
import {
  criarProposta,
  listarPropostasDaCaptacao,
  propostaCompraEnabled,
} from "@/lib/proposta-compra-db";
import {
  TOM_SITUACAO,
  dataBr,
  lerDetalhe,
  lerLista,
  textoValidade,
  type PropostaResumo,
} from "@/lib/proposta-compra-tela";

type LeadOpcao = { id: string; nome: string };

/**
 * Aba "Propostas" da captação (t_da0dac53): histórico (data, comprador, valor, corretor, situação, validade)
 * e "Nova proposta de compra". Só aparece com o módulo proposta_compra ligado; o banco decide quem vê e quem
 * cria (captador, corretores e gestor da mesma equipe, captação aprovada).
 */
export function PropostasCaptacao({
  captureId,
  podeCriar,
}: {
  captureId: string;
  /** Mesma regra do "Virou venda" (captação aprovada e quem pode transformar em venda). */
  podeCriar: boolean;
}) {
  const navigate = useNavigate();
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [lista, setLista] = useState<PropostaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadOpcao[]>([]);
  const [leadId, setLeadId] = useState("");
  const [busy, setBusy] = useState(false);
  const hoje = hojeSaoPaulo();

  const carregar = useCallback(async () => {
    try {
      setLista(lerLista(await listarPropostasDaCaptacao(captureId)));
      setErro(null);
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível carregar as propostas."));
    }
  }, [captureId]);

  useEffect(() => {
    let vivo = true;
    void propostaCompraEnabled().then((on) => {
      if (!vivo) return;
      setLigado(on);
      if (on) void carregar();
    });
    return () => {
      vivo = false;
    };
  }, [carregar]);

  // Leads do CRM ligados a este imóvel (a RLS de leads decide o que aparece). Falha = sem lista.
  useEffect(() => {
    if (!ligado || !podeCriar) return;
    let vivo = true;
    void (supabase as unknown as SupabaseClient)
      .from("leads")
      .select("id,nome")
      .eq("capture_id", captureId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (vivo && !error) setLeads(((data ?? []) as LeadOpcao[]).filter((l) => l.id && l.nome));
      });
    return () => {
      vivo = false;
    };
  }, [ligado, podeCriar, captureId]);

  if (!ligado) return null;

  const nova = async () => {
    setBusy(true);
    try {
      const d = lerDetalhe(await criarProposta(captureId, leadId || null));
      toast.success("Rascunho criado com os dados da captação.");
      navigate({ to: "/propostas/$id", params: { id: d.id } });
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível criar a proposta."));
      setBusy(false);
    }
  };

  return (
    <Card data-testid="aba-propostas">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4" aria-hidden /> Propostas
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Propostas de compra deste imóvel. Cada parte assina pelo celular, com link e código no
          WhatsApp.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !lista ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="sem-propostas">
            Nenhuma proposta registrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="lista-propostas">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Comprador</th>
                  <th className="py-2 pr-3 font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Corretor</th>
                  <th className="py-2 pr-3 font-medium">Situação</th>
                  <th className="py-2 pr-3 font-medium">Validade</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" data-situacao={p.situacao}>
                    <td className="py-2 pr-3 whitespace-nowrap">{dataBr(p.criadoEm)}</td>
                    <td className="py-2 pr-3">{p.comprador ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatBRLOu(p.valorOferta, "—")}
                    </td>
                    <td className="py-2 pr-3">{p.corretor ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Pill tom={TOM_SITUACAO[p.situacao]}>{SITUACAO_LABEL[p.situacao]}</Pill>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {p.situacao === "aguardando_assinaturas" || p.situacao === "vencida"
                        ? (textoValidade(p.validadeAte, hoje) ?? "—")
                        : p.validadeAte
                          ? `até ${dataBr(p.validadeAte)}`
                          : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/propostas/$id" params={{ id: p.id }}>
                          Abrir
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {podeCriar && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            {leads.length > 0 && (
              <div className="min-w-56 space-y-1">
                <Label htmlFor="proposta-lead">Comprador do CRM (opcional)</Label>
                <select
                  id="proposta-lead"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-base"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                >
                  <option value="">Sem lead (preencher na proposta)</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button disabled={busy} onClick={nova} data-testid="nova-proposta">
              <FilePlus2 className="mr-1 h-4 w-4" /> Nova proposta de compra
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
