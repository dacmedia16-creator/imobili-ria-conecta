// Pré-aprovação da locação: "Quem preenche os dados?" (corretor ou cliente por link individual) — maquete aprovada
// por Denis em 13/11 (t_b2ce1207). Escopo PRÓPRIO, separado do link da Documentação (LocacaoLinks, PR #316): as RPCs
// locacao_pre_links_* só valem na pré-análise. O token só existe em claro logo após gerar; o banco guarda o hash.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { GARANTIA_LABEL, reaisParaTela, type Garantia } from "@/lib/locacao";
import { emitirLinkPreLocacao } from "@/lib/locacao-pre-links.functions";
import { Opcao, PILL, dataHora } from "@/components/locacao/LocacaoLinks";

export type PartePre = "locatario" | "fiador";
export type StatusPreLink = {
  modo: "cliente" | "corretor";
  links: {
    parte: PartePre;
    status: string;
    expira_em: string;
    enviado_em: string | null;
    dados?: Record<string, string>;
    arquivos?: { item: string; nome: string | null }[];
  }[];
};
const NOME: Record<PartePre, string> = { locatario: "Locatário", fiador: "Fiador" };
const ROTULO: Record<string, string> = {
  cpf: "CPF",
  nome: "Nome completo",
  nascimento: "Nascimento",
  telefone: "Telefone",
  email: "E-mail",
  renda: "Renda mensal",
  matricula: "Nº da matrícula",
};
export const partesPre = (g: string): PartePre[] =>
  g === "fiador" ? ["locatario", "fiador"] : ["locatario"];

/** Corretor pode enviar à gestora: modo corretor, ou todas as partes da garantia ATUAL enviaram. */
export function preLinksProntos(s: StatusPreLink | null, garantia: string): boolean {
  if (!s || s.modo !== "cliente") return true;
  return partesPre(garantia).every((p) =>
    s.links.some((l) => l.parte === p && l.status === "enviado"),
  );
}

export function LocacaoPreLinks({
  id,
  garantia,
  editavel,
  onStatus,
}: {
  id: string;
  garantia: string;
  editavel: boolean;
  onStatus?: (s: StatusPreLink) => void;
}) {
  const [estado, setEstado] = useState<StatusPreLink | null>(null);
  const [links, setLinks] = useState<Partial<Record<PartePre, string>>>({});
  const [aberto, setAberto] = useState<Partial<Record<PartePre, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const partes = partesPre(garantia);
  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc(
      "locacao_pre_links_lista" as never,
      { _id: id } as never,
    );
    if (error) throw new Error(error.message);
    const s = data as unknown as StatusPreLink;
    setEstado(s);
    onStatus?.(s);
  }, [id, onStatus]);
  useEffect(() => {
    void ler().catch(() => toast.error("Não foi possível ler os links."));
  }, [ler]);
  const agir = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível atualizar os links."));
    } finally {
      setBusy(false);
    }
  };
  const modo = (m: "cliente" | "corretor") => {
    if (estado?.modo === m) return;
    if (
      m === "corretor" &&
      estado?.links.length &&
      !window.confirm("Voltar para 'Eu preencho' cancela os links enviados aos clientes.")
    )
      return;
    void agir(async () => {
      const { error } = await supabase.rpc(
        "locacao_pre_links_modo" as never,
        { _id: id, _modo: m } as never,
      );
      if (error) throw new Error(error.message);
      setLinks({});
      await ler();
      toast.success(
        m === "cliente" ? "Cliente preenche por link" : "Corretor preenche; links cancelados",
      );
    });
  };
  const emitir = (p: PartePre) =>
    void agir(async () => {
      const r = await emitirLinkPreLocacao({ data: { locacaoId: id, parte: p } });
      const url = `${window.location.origin}/locacao-pre/${r.token}`;
      setLinks((v) => ({ ...v, [p]: url }));
      await ler();
      toast.success(`Novo link de ${NOME[p]} criado. O anterior não vale mais.`);
    });
  const cliente = estado?.modo === "cliente";
  const pendentes = partes.filter(
    (p) => estado?.links.find((l) => l.parte === p)?.status !== "enviado",
  );

  return (
    <div className="space-y-3" data-testid="locacao-pre-quem-preenche">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quem preenche os dados?</CardTitle>
          <p className="text-sm text-muted-foreground">
            Você pode mudar esta escolha antes de enviar para a gestora.
          </p>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" className="flex flex-col gap-3 sm:flex-row">
            <Opcao
              ativo={!!estado && !cliente}
              titulo="Eu preencho"
              texto="O corretor registra os dados e confere a pré-aprovação por aqui."
              disabled={!editavel || busy || !estado}
              onClick={() => modo("corretor")}
            />
            <Opcao
              ativo={cliente}
              titulo="Cliente preenche"
              texto="Cada pessoa recebe um link individual. Você acompanha, confere e decide quando enviar."
              disabled={!editavel || busy || !estado}
              onClick={() => modo("cliente")}
            />
          </div>
        </CardContent>
      </Card>

      {cliente && estado && (
        <Card data-testid="locacao-pre-links">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Links individuais da pré-aprovação</CardTitle>
              <span
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium"
                data-testid="locacao-pre-links-garantia"
              >
                Garantia: {GARANTIA_LABEL[garantia as Garantia] ?? garantia}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              O cliente vê só a parte dele, sem valores. Links expiram em 7 dias; novo link invalida
              o anterior. Trocar a garantia muda na hora o que o link pede.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {partes.map((p) => {
              const s = estado.links.find((l) => l.parte === p);
              const url = links[p];
              const vencido = !!s && s.status !== "enviado" && new Date(s.expira_em) < new Date();
              const [rot, cor] = vencido
                ? ["Vencido", "bg-red-100 text-red-800"]
                : s
                  ? (PILL[s.status] ?? [s.status, "bg-slate-100"])
                  : ["Sem link", "bg-slate-100 text-slate-600"];
              const texto = `Olá! Preencha seus dados para a pré-aprovação da locação por este link individual (válido por 7 dias): ${url}`;
              const preenchidos = Object.entries(s?.dados ?? {}).filter(([, v]) => v);
              return (
                <div key={p} className="rounded-xl border p-4 text-sm" data-parte={p}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <b className="text-base">{NOME[p]}</b>
                      <p className="text-xs text-muted-foreground">
                        {!s
                          ? "Gere o link para enviar a esta pessoa."
                          : s.status === "enviado" && s.enviado_em
                            ? `Recebido em ${dataHora(s.enviado_em)} · confira abaixo`
                            : `Expira em ${dataHora(s.expira_em)}`}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${cor}`}>
                      {rot}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {url && s?.status !== "enviado" && (
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
                          Abrir WhatsApp ↗
                        </Button>
                      </>
                    )}
                    {s?.status === "enviado" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAberto((v) => ({ ...v, [p]: !v[p] }))}
                      >
                        {aberto[p] ? "Fechar dados recebidos" : "Abrir dados recebidos"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!editavel || busy}
                      onClick={() => emitir(p)}
                    >
                      {s ? "Gerar novo link" : "Gerar link"}
                    </Button>
                  </div>
                  {s && !url && s.status !== "enviado" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Por segurança o link não fica salvo. Para reenviar, gere outro e copie ou abra
                      o WhatsApp.
                    </p>
                  )}
                  {aberto[p] && s && (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
                      {preenchidos.length ? (
                        <dl className="grid gap-1 sm:grid-cols-2">
                          {preenchidos.map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-muted-foreground">{ROTULO[k] ?? k}</dt>
                              <dd className="font-medium">
                                {k === "renda" ? `R$ ${reaisParaTela(v)}` : v}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p>Sem dados preenchidos.</p>
                      )}
                      {p === "fiador" && (
                        <p className="mt-2">
                          Matrícula anexada:{" "}
                          {s.arquivos?.length
                            ? s.arquivos.map((a) => a.nome).join("; ")
                            : "não (opcional)"}
                          .
                        </p>
                      )}
                      <p className="mt-2">
                        Os dados entram nos campos vazios da ficha abaixo, para sua conferência.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <p
              className="rounded-lg bg-primary/5 p-3 text-sm text-primary"
              data-testid="locacao-pre-links-aviso"
            >
              {pendentes.length
                ? `Aguardando ${pendentes.map((p) => NOME[p].toLowerCase()).join(" e ")}. `
                : "Todas as partes enviaram. Confira os dados abaixo. "}
              O cliente nunca envia direto à gestora; você confere e envia.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
