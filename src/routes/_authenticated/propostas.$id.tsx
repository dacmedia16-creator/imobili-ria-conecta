import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  FileSearch,
  Handshake,
  RefreshCw,
  Repeat2,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListSkeleton, Pill } from "@/components/visual/base";
import { PaginasPdf } from "@/components/exclusividades/PaginasPdf";
import { PropostaFormulario } from "@/components/proposta-compra/PropostaFormulario";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { loadCurrentAgencyBrand, logoForPdf } from "@/lib/agency-brand";
import {
  AVISO_TEXTO_ADVOGADO,
  SITUACAO_LABEL,
  TEXTO_APROVADO_ADVOGADO,
} from "@/lib/proposta-compra";
import { faltasCadastro } from "@/lib/proposta-compra-texto";
import {
  anexarPdfNaVenda,
  comprovacaoProposta,
  contraproposta,
  criarVendaDaProposta,
  detalheProposta,
  propostaCompraEnabled,
  recusarProposta,
  prepararPdfProposta,
  registrarPdfProposta,
  salvarProposta,
  sha256Hex,
} from "@/lib/proposta-compra-db";
import { enviarProposta } from "@/lib/proposta-compra.functions";
import { buildPropostaPdf, nomeArquivoProposta } from "@/lib/proposta-compra-pdf";
import {
  EVENTO_LABEL,
  SITUACAO_PARTE_LABEL,
  TOM_SITUACAO,
  acoes,
  dadosParaSalvar,
  dataHoraSp,
  errosDoForm,
  formDoDetalhe,
  lerComprovacao,
  lerDetalhe,
  ordenarPartes,
  rotuloParte,
  situacaoParte,
  textoValidade,
  type PropostaDetalhe,
  type PropostaForm,
} from "@/lib/proposta-compra-tela";

// Proposta de compra 2/3 (t_da0dac53): Nova proposta (rascunho), Prévia do PDF, Assinaturas e
// "Criar venda em rascunho". Tudo atrás do módulo proposta_compra; o banco repete cada checagem.
export const Route = createFileRoute("/_authenticated/propostas/$id")({
  head: () => ({ meta: [{ title: "Proposta de compra" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session || !(await propostaCompraEnabled())) throw redirect({ to: "/dashboard" });
  },
  component: PropostaPage,
});

type Aba = "dados" | "previa" | "assinaturas";

function PropostaPage() {
  const { id } = Route.useParams();
  return <PropostaConteudo id={id} />;
}

export function PropostaConteudo({ id }: { id: string }) {
  const navigate = useNavigate();
  const [d, setD] = useState<PropostaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<PropostaForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aba, setAba] = useState<Aba>("dados");
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState<null | "enviar" | "venda" | "contraproposta">(null);
  const hoje = hojeSaoPaulo();

  const aplicar = useCallback((raw: unknown) => {
    const det = lerDetalhe(raw);
    setD(det);
    setForm(formDoDetalhe(det));
    setDirty(false);
    return det;
  }, []);

  const carregar = useCallback(async () => {
    try {
      const det = aplicar(await detalheProposta(id));
      setErro(null);
      setAba((a) => (a === "dados" && det.situacao !== "rascunho" ? "assinaturas" : a));
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível abrir a proposta."));
    }
  }, [id, aplicar]);

  useEffect(() => {
    setD(null);
    setPdf(null);
    setAba("dados");
    void carregar();
  }, [carregar]);

  const ac = useMemo(() => (d ? acoes(d) : null), [d]);
  const errosForm = useMemo(() => (form ? errosDoForm(form) : []), [form]);

  if (erro) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erro}</p>
        <Button variant="outline" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (!d || !form || !ac) return <ListSkeleton />;

  const rodar = async (fn: () => Promise<void>, falha: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, falha));
    } finally {
      setBusy(false);
    }
  };

  const salvar = () =>
    rodar(async () => {
      if (errosForm.length) throw new Error(errosForm[0]);
      const antes = d.versao;
      const det = aplicar(await salvarProposta(d.id, dadosParaSalvar(form)));
      setPdf(null);
      toast.success(
        det.versao > antes
          ? "Nova versão salva. As assinaturas anteriores deixaram de valer: gere o PDF e envie de novo."
          : "Rascunho salvo.",
      );
    }, "Não foi possível salvar.");

  const marca = async () => {
    const brand = await loadCurrentAgencyBrand().catch(() => null);
    return { nome: brand?.nome ?? null, logo: await logoForPdf(brand?.pdfLogoUrl ?? null) };
  };

  const gerarPrevia = () =>
    rodar(async () => {
      let det = d;
      if (dirty) {
        if (errosForm.length) throw new Error(errosForm[0]);
        det = aplicar(await salvarProposta(d.id, dadosParaSalvar(form)));
      }
      // Texto oficial: no rascunho, fixa a data do documento e o cadastro da imobiliária antes do PDF.
      if (det.situacao === "rascunho") det = aplicar(await prepararPdfProposta(det.id));
      const m = await marca();
      // Data fixa (criação da proposta): mesmo conteúdo + mesmo logo = mesmo arquivo, então o hash
      // registrado pode ser conferido gerando o PDF de novo.
      const criada = new Date(det.criadoEm);
      const bytes = await buildPropostaPdf({
        proposta: det,
        imobiliaria: m.nome,
        logo: m.logo,
        emitidoEm: Number.isNaN(criada.getTime()) ? undefined : criada,
      });
      if (det.situacao === "rascunho") {
        aplicar(await registrarPdfProposta(det.id, det.versao, await sha256Hex(bytes)));
      }
      setPdf(bytes);
      setAba("previa");
    }, "Não foi possível gerar o PDF.");

  const enviar = (partes: string[] | null) =>
    rodar(async () => {
      const r = await enviarProposta({ data: { propostaId: d.id, partes } });
      const enviados = r.resultados.filter((x) => x.status === "enviado").length;
      const simulados = r.resultados.filter((x) => x.status === "simulado").length;
      const falhas = r.resultados.filter(
        (x) => x.status === "falhou" || x.status === "bloqueado",
      ).length;
      const partesMsg: string[] = [];
      if (r.modo === "simulacao")
        partesMsg.push(
          `Modo de teste: ${simulados} código(s) gerado(s), nenhuma mensagem saiu pelo WhatsApp.`,
        );
      else partesMsg.push(`${enviados} mensagem(ns) enviada(s).`);
      if (falhas) partesMsg.push(`${falhas} falha(s).`);
      if (r.aguarde) partesMsg.push(`${r.aguarde} parte(s) receberam código há menos de 1 minuto.`);
      if (r.semTelefone) partesMsg.push(`${r.semTelefone} parte(s) sem celular.`);
      toast[falhas ? "warning" : "success"](partesMsg.join(" "));
      await carregar();
      setAba("assinaturas");
    }, "Não foi possível enviar.");

  const recusar = () =>
    rodar(async () => {
      aplicar(await recusarProposta(d.id, motivo.trim()));
      setRecusando(false);
      setMotivo("");
      toast.success("Proposta registrada como recusada.");
    }, "Não foi possível registrar a recusa.");

  const fazerContraproposta = () =>
    rodar(async () => {
      const nova = lerDetalhe(await contraproposta(d.id));
      toast.success("Contraproposta aberta já preenchida. A anterior fica no histórico.");
      navigate({ to: "/propostas/$id", params: { id: nova.id } });
    }, "Não foi possível abrir a contraproposta.");

  const pdfFinal = async (det: PropostaDetalhe) => {
    const comp = lerComprovacao(await comprovacaoProposta(det.id));
    const m = await marca();
    return buildPropostaPdf({
      proposta: det,
      imobiliaria: m.nome,
      logo: m.logo,
      comprovacao: comp,
    });
  };

  const baixarFinal = () =>
    rodar(async () => {
      const bytes = await pdfFinal(d);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivoProposta(d.documento, d.versao, true);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "Não foi possível gerar o PDF.");

  // Só no clique (D: nunca criar a venda sozinho). O banco usa o "Virou venda" existente e não duplica.
  const criarVenda = () =>
    rodar(async () => {
      const r = await criarVendaDaProposta(d.id);
      if (r.criada) {
        try {
          await anexarPdfNaVenda(
            r.venda_id,
            await pdfFinal(d),
            nomeArquivoProposta(d.documento, d.versao, true),
          );
        } catch {
          toast.warning(
            "Venda criada, mas o PDF assinado não foi anexado. Baixe e anexe na venda.",
          );
        }
      }
      toast.success(
        r.criada
          ? "Venda criada em rascunho com os dados da proposta."
          : "Abrindo a venda já criada.",
      );
      navigate({ to: "/vendas/$id", params: { id: r.venda_id } });
    }, "Não foi possível criar a venda.");

  const partes = ordenarPartes(d.partes);
  const totalVend = partes.filter((p) => p.papel === "vendedor").length;
  const validade = textoValidade(d.validadeAte, hoje);
  const assinaram = partes.filter((p) => p.assinadoEm).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/exclusividades/$id" params={{ id: d.captureId }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Captação
          </Link>
        </Button>
      </div>
      <header className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          Proposta de compra {d.documento}
          <Pill tom={TOM_SITUACAO[d.situacao]}>{SITUACAO_LABEL[d.situacao]}</Pill>
        </h1>
        <p className="text-sm text-muted-foreground">
          Versão {d.versao}
          {d.corretorNome ? ` · Corretor: ${d.corretorNome}` : ""}
          {validade && (d.situacao === "aguardando_assinaturas" || d.situacao === "vencida")
            ? ` · ${validade}`
            : ""}
          {d.situacao === "aguardando_assinaturas"
            ? ` · ${assinaram} de ${partes.length} assinaram`
            : ""}
        </p>
        {d.origemId && (
          <p className="text-xs text-muted-foreground">
            Contraproposta de{" "}
            <Link className="underline" to="/propostas/$id" params={{ id: d.origemId }}>
              proposta anterior
            </Link>
            .
          </p>
        )}
        {d.situacao === "recusada" && d.recusaMotivo && (
          <p
            className="rounded-md bg-rose-50 p-2 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200"
            data-testid="motivo-recusa"
          >
            Recusada: {d.recusaMotivo}
          </p>
        )}
        {!d.podeOperar && (
          <p className="text-xs text-muted-foreground">
            Você pode ver esta proposta, mas não alterar.
          </p>
        )}
      </header>

      <nav aria-label="Etapas da proposta" className="grid grid-cols-3 gap-2">
        {(
          [
            ["dados", "1. Dados"],
            ["previa", "2. Prévia do PDF"],
            ["assinaturas", "3. Assinaturas"],
          ] as const
        ).map(([k, rot]) => (
          <Button
            key={k}
            variant={aba === k ? "default" : "outline"}
            className="h-auto min-h-11 whitespace-normal"
            aria-current={aba === k ? "step" : undefined}
            onClick={() => (k === "previa" && !pdf ? void gerarPrevia() : setAba(k))}
            disabled={busy}
          >
            {rot}
          </Button>
        ))}
      </nav>

      {aba === "dados" && (
        <>
          {d.situacao === "aguardando_assinaturas" && ac.editar && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Esta proposta já foi enviada. Alterar o texto ou os valores cria uma nova versão e as
              assinaturas anteriores deixam de valer.
            </p>
          )}
          <PropostaFormulario
            form={form}
            onChange={(f) => {
              setForm(f);
              setDirty(true);
            }}
            imovel={d.imovel}
            corretor={d.corretorNome}
            disabled={!ac.editar || busy}
          />
          {errosForm.length > 0 && dirty && (
            <ul className="list-disc pl-5 text-sm text-destructive" data-testid="erros-form">
              {errosForm.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {ac.editar && (
            <div className="sticky bottom-2 flex flex-wrap gap-2 rounded-md bg-background/95 p-2 shadow-sm ring-1 ring-border">
              <Button
                variant="outline"
                disabled={busy || !dirty}
                onClick={salvar}
                data-testid="salvar-rascunho"
              >
                <Save className="mr-1 h-4 w-4" /> Salvar rascunho
              </Button>
              <Button disabled={busy} onClick={gerarPrevia} data-testid="ver-previa">
                <FileSearch className="mr-1 h-4 w-4" /> Ver a proposta (PDF)
              </Button>
            </div>
          )}
        </>
      )}

      {aba === "previa" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prévia da proposta</CardTitle>
            <p className="text-sm text-muted-foreground">
              PDF gerado pelo ADM MAX com o texto oficial e os dados do cadastro da imobiliária.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!TEXTO_APROVADO_ADVOGADO && (
              <div
                className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                data-testid="aviso-advogado"
              >
                <p className="font-semibold">{AVISO_TEXTO_ADVOGADO}</p>
              </div>
            )}
            {faltasCadastro(d.cadastro ?? d.cadastroAtual).map((a) => (
              <p
                key={a}
                className="rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900"
                data-testid="aviso-cadastro"
              >
                {a}
              </p>
            ))}
            {pdf ? (
              <PaginasPdf bytes={pdf} nome={nomeArquivoProposta(d.documento, d.versao)} />
            ) : (
              <Button disabled={busy} onClick={gerarPrevia}>
                Gerar a prévia
              </Button>
            )}
            {d.situacao === "rascunho" && d.pendenciasEnvio.length > 0 && (
              <div className="rounded-md border p-3 text-sm" data-testid="pendencias-envio">
                <p className="font-medium">Falta preencher para enviar:</p>
                <p className="text-muted-foreground">{d.pendenciasEnvio.join(", ")}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {ac.editar && (
                <Button variant="outline" disabled={busy} onClick={() => setAba("dados")}>
                  Voltar e corrigir
                </Button>
              )}
              {d.situacao === "rascunho" && d.podeOperar && (
                <Button
                  disabled={busy || !ac.enviar || dirty}
                  onClick={() => setConfirmar("enviar")}
                  data-testid="enviar-assinatura"
                >
                  <Send className="mr-1 h-4 w-4" /> Enviar para assinatura pelo WhatsApp
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {aba === "assinaturas" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assinaturas</CardTitle>
            <p className="text-sm text-muted-foreground">
              Cada parte recebe o próprio link e código pelo WhatsApp da imobiliária. Proposta
              aceita = todas as partes assinaram.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.situacao === "rascunho" ? (
              <p className="text-sm text-muted-foreground">
                Ainda não enviada. Gere a prévia e envie.
              </p>
            ) : null}
            <ul className="divide-y" data-testid="lista-assinaturas">
              {partes.map((p) => {
                const st = situacaoParte(p);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 py-2.5"
                    data-situacao-parte={st}
                  >
                    <span
                      aria-hidden
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        st === "assinou"
                          ? "bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {st === "assinou" ? "✓" : "…"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {p.nome ?? "(sem nome)"}{" "}
                        <span className="font-normal text-muted-foreground">
                          · {rotuloParte(p.papel, p.ordem, totalVend)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {st === "assinou"
                          ? `Assinou em ${dataHoraSp(p.assinadoEm)}`
                          : SITUACAO_PARTE_LABEL[st]}
                        {st === "aguardando" && p.codigo?.tentativas
                          ? ` · ${p.codigo.tentativas} tentativa(s) errada(s)`
                          : ""}
                      </p>
                    </div>
                    {ac.reenviar && st !== "assinou" && st !== "sem_celular" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void enviar([p.id])}
                      >
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />{" "}
                        {p.codigo ? "Reenviar" : "Enviar"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              {ac.reenviar && (
                <Button
                  disabled={busy}
                  onClick={() => void enviar(null)}
                  data-testid="reenviar-faltam"
                >
                  <Send className="mr-1 h-4 w-4" /> Reenviar para quem falta
                </Button>
              )}
              {ac.editar && d.situacao === "aguardando_assinaturas" && (
                <Button variant="outline" disabled={busy} onClick={() => setAba("dados")}>
                  Alterar a proposta
                </Button>
              )}
              {ac.contraproposta && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmar("contraproposta")}
                  data-testid="contraproposta"
                >
                  <Repeat2 className="mr-1 h-4 w-4" /> Contraproposta
                </Button>
              )}
              {ac.recusar && (
                <Button
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={busy}
                  onClick={() => setRecusando(true)}
                  data-testid="recusar"
                >
                  <XCircle className="mr-1 h-4 w-4" /> Recusada
                </Button>
              )}
              {assinaram > 0 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={baixarFinal}
                  data-testid="baixar-final"
                >
                  <Download className="mr-1 h-4 w-4" /> PDF com comprovação das assinaturas
                </Button>
              )}
            </div>
            {recusando && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="motivo-recusa">Motivo da recusa</Label>
                <Textarea
                  id="motivo-recusa"
                  value={motivo}
                  maxLength={1000}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setRecusando(false)} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || motivo.trim().length < 3}
                    onClick={recusar}
                    data-testid="confirmar-recusa"
                  >
                    Registrar recusa
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {d.situacao === "aceita" && (
        <Card className="border-emerald-300" data-testid="bloco-aceita">
          <CardHeader>
            <CardTitle className="text-base">Proposta aceita 🎉</CardTitle>
            <p className="text-sm text-muted-foreground">
              Um clique transforma a proposta em venda, sem digitar de novo: imóvel e captação,
              comprador, vendedores e cônjuges, valor, sinal e financiamento, e o PDF assinado
              anexado. A venda nasce como rascunho e segue o fluxo de sempre.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {d.vendaId ? (
              <Button asChild>
                <Link to="/vendas/$id" params={{ id: d.vendaId }}>
                  Abrir a venda
                </Link>
              </Button>
            ) : ac.criarVenda ? (
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={busy}
                onClick={() => setConfirmar("venda")}
                data-testid="criar-venda"
              >
                <Handshake className="mr-1 h-4 w-4" /> Criar venda em rascunho
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm" data-testid="historico-proposta">
            {[...d.eventos].reverse().map((e, i) => (
              <li key={`${e.criadoEm}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{dataHoraSp(e.criadoEm)}</span>
                <span>{EVENTO_LABEL[e.tipo] ?? e.tipo}</span>
                {e.detalhe && <span className="text-muted-foreground">· {e.detalhe}</span>}
                {e.versao ? <span className="text-muted-foreground">· v{e.versao}</span> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmar === "enviar"}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title="Enviar para assinatura?"
        description={`Cada parte recebe uma mensagem individual com o próprio link e código. A validade de ${d.validadeDias} dia(s) corridos começa a contar agora.`}
        confirmLabel="Enviar"
        onConfirm={() => void enviar(null)}
        testId="confirmar-envio"
      />
      <ConfirmDialog
        open={confirmar === "contraproposta"}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title="Abrir contraproposta?"
        description="Esta proposta fica no histórico como contraproposta (os códigos em aberto deixam de valer) e abre uma nova, já preenchida, para ajustar e enviar."
        confirmLabel="Abrir contraproposta"
        onConfirm={() => void fazerContraproposta()}
        testId="confirmar-contraproposta"
      />
      <ConfirmDialog
        open={confirmar === "venda"}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title="Criar venda em rascunho?"
        description="A venda é criada pelo mesmo caminho do “Virou venda”, com as partes, os valores e o PDF assinado. Ela nasce como rascunho."
        confirmLabel="Criar venda"
        onConfirm={() => void criarVenda()}
        testId="confirmar-venda"
      />
    </div>
  );
}
