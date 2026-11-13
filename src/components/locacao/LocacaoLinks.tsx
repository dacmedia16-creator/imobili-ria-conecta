// Locação: "Quem preenche a documentação?" (corretor ou cliente por link individual). Visual aprovado por
// Denis na maquete de 13/11 (t_6fafa9be). O token só existe em claro logo após gerar; o banco guarda o hash.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { CAMPOS_CONTRATO } from "@/lib/locacao-contrato";
import { GARANTIA_LABEL, type Garantia } from "@/lib/locacao";
import { partesParaLink, type ParteLink } from "@/lib/locacao-links";
import { emitirLinkLocacao } from "@/lib/locacao-links.functions";

export type StatusLink = {
  modo: "cliente" | "corretor";
  links: {
    parte: ParteLink;
    status: string;
    expira_em: string;
    enviado_em: string | null;
    dados?: Record<string, string>;
    arquivos?: { item: string; nome: string | null }[];
  }[];
};
const nome: Record<ParteLink, string> = {
  proprietario: "Proprietário",
  locatario: "Locatário",
  fiador: "Fiador",
};
export const PILL: Record<string, [string, string]> = {
  nao_aberto: ["Não aberto", "bg-slate-100 text-slate-700"],
  em_preenchimento: ["Em preenchimento", "bg-amber-100 text-amber-800"],
  enviado: ["Enviado ao corretor", "bg-emerald-100 text-emerald-800"],
};
export const dataHora = (iso: string) => {
  const d = new Date(iso);
  const tz = { timeZone: "America/Sao_Paulo" } as const;
  return `${d.toLocaleDateString("pt-BR", tz)} às ${d.toLocaleTimeString("pt-BR", {
    ...tz,
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};
const rotuloCampo = (k: string) => CAMPOS_CONTRATO.find((c) => c.k === k)?.label ?? k;

export function Opcao({
  ativo,
  titulo,
  texto,
  onClick,
  disabled,
}: {
  ativo: boolean;
  titulo: string;
  texto: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-1 items-start justify-between gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ${
        ativo ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      <span>
        <b className="block">{titulo}</b>
        <span className="text-sm text-muted-foreground">{texto}</span>
      </span>
      <span
        aria-hidden
        className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
          ativo ? "border-primary bg-primary" : "border-slate-300"
        }`}
      >
        {ativo && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  );
}

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
  const [aberto, setAberto] = useState<Partial<Record<ParteLink, boolean>>>({});
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
      !window.confirm("Voltar para 'Eu preencho' cancela todos os links enviados aos clientes.")
    )
      return;
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
          : "Corretor preenche; links cancelados",
      );
    });
  };
  const emitir = (p: ParteLink) =>
    void agir(async () => {
      const r = await emitirLinkLocacao({ data: { locacaoId: id, parte: p } });
      const url = `${window.location.origin}/locacao-link/${r.token}`;
      setLinks((v) => ({ ...v, [p]: url }));
      await ler();
      toast.success(`Novo link de ${nome[p]} criado. O anterior não vale mais.`);
    });
  const cliente = estado?.modo === "cliente";
  const pendentes = partes.filter(
    (p) => estado?.links.find((l) => l.parte === p)?.status !== "enviado",
  );

  return (
    <div className="space-y-4" data-testid="locacao-cliente-preenche">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quem preenche a documentação?</CardTitle>
          <p className="text-sm text-muted-foreground">
            Você pode mudar esta escolha antes de enviar para a gestora.
          </p>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" className="flex flex-col gap-3 sm:flex-row">
            <Opcao
              ativo={!!estado && !cliente}
              titulo="Eu preencho"
              texto="O corretor registra os dados e anexa os documentos por aqui."
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
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Links individuais por parte</CardTitle>
              <span
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium"
                data-testid="locacao-links-garantia"
              >
                Garantia: {GARANTIA_LABEL[garantia as Garantia] ?? garantia}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Links expiram em 7 dias. Novo link invalida o anterior. WhatsApp abre uma mensagem
              pronta; nenhum envio automático.
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
              const texto = `Olá! Preencha seus dados e anexe os documentos da locação por este link individual (válido por 7 dias): ${url}`;
              const preenchidos = Object.entries(s?.dados ?? {}).filter(([, v]) => v);
              return (
                <div key={p} className="rounded-xl border p-4 text-sm" data-parte={p}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <b className="text-base">{nome[p]}</b>
                      <p className="text-xs text-muted-foreground">
                        {!s
                          ? "Gere o link para enviar a esta pessoa."
                          : s.status === "enviado" && s.enviado_em
                            ? `Recebido em ${dataHora(s.enviado_em)} · corretor deve conferir`
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
                              <dt className="text-muted-foreground">{rotuloCampo(k)}</dt>
                              <dd className="font-medium">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p>Sem dados preenchidos.</p>
                      )}
                      <p className="mt-2">
                        Documentos:{" "}
                        {s.arquivos?.length ? s.arquivos.map((a) => a.item).join("; ") : "nenhum"}.
                        Os dados entram nos campos vazios do contrato e os arquivos no checklist
                        abaixo, para sua conferência.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            <p
              className="rounded-lg bg-primary/5 p-3 text-sm text-primary"
              data-testid="locacao-links-aviso"
            >
              {pendentes.length
                ? `Aguardando ${pendentes.map((p) => nome[p].toLowerCase()).join(" e ")}. `
                : "Todas as partes enviaram. Confira os dados abaixo. "}
              O cliente nunca envia diretamente à gestora; o corretor confirma o próximo passo.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
