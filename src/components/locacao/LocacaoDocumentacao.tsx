// Etapa Documentação da locação (t_127811ca): o corretor sobe os documentos, a IA lê cada um (mesmo comportamento
// da venda: selo, nova tentativa, só preenche campo vazio) e ele confere/completa os dados do contrato.
// O banco repete toda checagem (corretor, etapa, campos válidos, trava de envio).
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  FileUp,
  Loader2,
  Paperclip,
  PenLine,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { GARANTIA_LABEL, type ContextoLocacao, type DocumentoLocacao } from "@/lib/locacao";
import type { LocacaoDetalhe as Detalhe } from "@/lib/locacao";
import {
  CAMPOS_CONTRATO,
  ESTADOS_CIVIS,
  SECOES,
  alteracoes,
  casado,
  faltasContrato,
  lerContrato,
  valorOk,
  type OrigemCampo,
} from "@/lib/locacao-contrato";
import { ERRO_LEITURA_TEXTO, itemLidoPorIa, type ErroLeitura } from "@/lib/locacao-ia";
import {
  abrirDocumento,
  anexarDocumento,
  enviarDocumentacao,
  lerDocumentoIa,
  removerDocumento,
  salvarContrato,
} from "@/lib/locacao-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  d: Detalhe;
  ctx: ContextoLocacao;
  busy: boolean;
  rodar: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  recarregar: () => Promise<void>;
  editavel: boolean;
  aviso: (tom: "blue" | "amber" | "red" | "green", conteudo: ReactNode) => ReactNode;
};

export function SeloIa({ doc, lendo }: { doc: DocumentoLocacao; lendo: boolean }) {
  if (lendo || doc.leitura === "pendente")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-900">
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> IA lendo
      </span>
    );
  if (doc.leitura === "ok")
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-900"
        title={`${doc.preenchidos} campo(s) preenchido(s) por este documento`}
      >
        <Sparkles className="h-3 w-3" /> IA ok
      </span>
    );
  if (doc.leitura === "falhou")
    return (
      <span
        className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] text-destructive"
        title={ERRO_LEITURA_TEXTO[(doc.leituraErro ?? "FALHA") as ErroLeitura] ?? ""}
      >
        IA falhou
      </span>
    );
  if (doc.leitura === "sem_leitura")
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        sem leitura automática
      </span>
    );
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      Aguardando IA
    </span>
  );
}

function SeloOrigem({ o }: { o: OrigemCampo }) {
  if (o.o === "ia")
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[10px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
        title={o.item ? `Lido pela IA: ${o.item}` : "Lido pela IA"}
      >
        <Sparkles className="h-2.5 w-2.5" /> lido{o.item ? ` · ${o.item}` : ""}
      </span>
    );
  if (o.o === "manual")
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-sky-50 px-1 text-[10px] text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
        <PenLine className="h-2.5 w-2.5" /> digitado
      </span>
    );
  if (o.o === "pre")
    return (
      <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        da pré-análise
      </span>
    );
  return (
    <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      falta
    </span>
  );
}

/** Formulário dos dados do contrato. Também usado só para leitura pela gestora na Conferência. */
export function DadosContrato({
  d,
  editavel,
  valores,
  origem,
  onChange,
}: {
  d: Detalhe;
  editavel: boolean;
  valores: Record<string, string>;
  origem: Record<string, OrigemCampo>;
  onChange?: (k: string, v: string) => void;
}) {
  const fiador = d.garantia === "fiador";
  const secoes = SECOES.filter((s) => !s.soFiador || fiador).filter(
    (s) =>
      (s.key !== "proprietario_conj" || casado(valores.prop_estado_civil)) &&
      (s.key !== "fiador_conj" || casado(valores.fia_estado_civil)),
  );
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="locacao-contrato">
      {secoes.map((sec) => (
        <Card key={sec.key} className={sec.key === "moradores" ? "lg:col-span-2" : undefined}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{sec.titulo}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {CAMPOS_CONTRATO.filter((c) => c.secao === sec.key)
              .filter(
                (c) =>
                  !c.k.endsWith("_regime") ||
                  casado(valores[c.k.replace("_regime", "_estado_civil")]),
              )
              .map((c) => {
                const v = valores[c.k] ?? "";
                const id = `ct-${c.k}`;
                const invalido = !valorOk(c.k, v.trim());
                const largo =
                  c.tipo === "longo" || c.k.endsWith("_endereco") || c.k === "fia_cartorio";
                return (
                  <div key={c.k} className={`space-y-1 ${largo ? "sm:col-span-2" : ""}`}>
                    <div className="flex flex-wrap items-center gap-1">
                      <Label htmlFor={id} className="text-xs">
                        {c.label}
                      </Label>
                      <SeloOrigem o={origem[c.k] ?? { o: "vazio" }} />
                    </div>
                    {c.tipo === "estado_civil" ? (
                      <select
                        id={id}
                        className={SELECT}
                        disabled={!editavel}
                        value={v}
                        onChange={(e) => onChange?.(c.k, e.target.value)}
                      >
                        <option value="">—</option>
                        {(ESTADOS_CIVIS.includes(v) || !v
                          ? ESTADOS_CIVIS
                          : [v, ...ESTADOS_CIVIS]
                        ).map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    ) : c.tipo === "longo" ? (
                      <Textarea
                        id={id}
                        disabled={!editavel}
                        value={v}
                        rows={3}
                        onChange={(e) => onChange?.(c.k, e.target.value)}
                        placeholder="Ex.: Ana Exemplo — CPF 000.000.000-00"
                      />
                    ) : (
                      <Input
                        id={id}
                        disabled={!editavel}
                        value={v}
                        type={c.tipo === "data" ? "date" : "text"}
                        inputMode={c.tipo === "numero" ? "numeric" : undefined}
                        aria-invalid={invalido || undefined}
                        className={invalido ? "border-destructive" : undefined}
                        onChange={(e) => onChange?.(c.k, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function LocacaoDocumentacao({ d, ctx, busy, rodar, recarregar, editavel, aviso }: Props) {
  const base = useMemo(() => lerContrato(d.contrato.valores, d.contrato.origem), [d.contrato]);
  const [form, setForm] = useState<Record<string, string>>(() => ({ ...base.valores }));
  const [lendo, setLendo] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState(false);

  // Campos que o corretor ainda não mexeu acompanham o banco (a IA pode ter preenchido algo novo).
  const [vistos, setVistos] = useState(base.valores);
  if (vistos !== base.valores) {
    setVistos(base.valores);
    setForm((f) => {
      const novo = { ...f };
      for (const [k, v] of Object.entries(base.valores))
        if ((f[k] ?? "") === (vistos[k] ?? "")) novo[k] = v;
      return novo;
    });
  }

  const mudou = alteracoes(base.valores, form);
  const sujo = Object.keys(mudou).length > 0;
  const origem: Record<string, OrigemCampo> = { ...base.origem };
  for (const k of Object.keys(mudou)) origem[k] = mudou[k] ? { o: "manual" } : { o: "vazio" };
  const faltasDados = faltasContrato(d.tipo, d.garantia, form);
  const invalidos = CAMPOS_CONTRATO.filter((c) => !valorOk(c.k, (form[c.k] ?? "").trim()));

  const docs = ctx.config.documentos;
  const blocos = [
    { titulo: "Locatário", itens: docs.locatario ?? [] },
    { titulo: `Garantia — ${GARANTIA_LABEL[d.garantia]}`, itens: docs[d.garantia] ?? [] },
    { titulo: "Proprietário", itens: docs.proprietario ?? [] },
  ];
  const total = d.checklist.length;
  const feitos = total - d.faltando.length;
  const ocupado = busy || salvando;

  const salvar = async (silencioso = false) => {
    if (!sujo) return;
    if (invalidos.length) throw new Error(`Confira: ${invalidos.map((c) => c.label).join(", ")}`);
    setSalvando(true);
    try {
      await salvarContrato(d.id, mudou);
      if (!silencioso) toast.success("Dados do contrato salvos");
    } finally {
      setSalvando(false);
    }
  };

  const ler = async (docId: string) => {
    setLendo((m) => ({ ...m, [docId]: true }));
    try {
      // O que o corretor digitou vai antes para o banco: a IA nunca sobrescreve campo preenchido.
      await salvar(true);
      const r = await lerDocumentoIa(docId);
      if (r.status === "ok")
        toast.success(
          r.preenchidos
            ? `IA leu o documento: ${r.preenchidos} campo(s) preenchido(s). Confira abaixo.`
            : "IA leu o documento: nada novo para preencher.",
        );
      else if (r.status === "falhou")
        toast.warning(`Leitura por IA: ${ERRO_LEITURA_TEXTO[r.erro]}.`);
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível ler o documento."));
    } finally {
      setLendo((m) => ({ ...m, [docId]: false }));
      await recarregar();
    }
  };

  const anexar = (item: string, arquivo: File | undefined) => {
    if (!arquivo) return;
    void rodar(async () => {
      const id = await anexarDocumento(d.id, item, arquivo);
      // Lê em seguida (sem esperar): o selo mostra "IA lendo" e o corretor pode continuar.
      if (id && itemLidoPorIa(item)) setTimeout(() => void ler(id), 0);
    }, `Anexado: ${item}`);
  };

  const pendentesIa = d.documentos.filter(
    (x) => itemLidoPorIa(x.item) && x.leitura !== "ok" && x.leitura !== "pendente" && !lendo[x.id],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Checklist para garantia <b>{GARANTIA_LABEL[d.garantia]}</b> — {feitos}/{total} itens
        </span>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${d.faltando.length ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${total ? (feitos / total) * 100 : 0}%` }}
          />
        </div>
        {editavel && pendentesIa.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={ocupado}
            onClick={() => pendentesIa.forEach((x) => void ler(x.id))}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Ler com IA ({pendentesIa.length})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {blocos.map((bl) => (
          <Card key={bl.titulo}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{bl.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {bl.itens.map((item) => {
                const anexos = d.documentos.filter((x) => x.item === item);
                return (
                  <div
                    key={item}
                    className="rounded-md border p-2 text-sm"
                    data-testid="locacao-doc-item"
                  >
                    <div className="flex items-start gap-2">
                      <span aria-hidden>{anexos.length ? "📄" : "⬜"}</span>
                      <span className="flex-1">{item}</span>
                      {editavel && (
                        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary">
                          <FileUp className="h-3.5 w-3.5" /> anexar
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            disabled={ocupado}
                            onChange={(ev) => {
                              anexar(item, ev.target.files?.[0]);
                              ev.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {anexos.map((a) => (
                      <div
                        key={a.id}
                        className="ml-6 mt-1 flex flex-wrap items-center gap-2 text-xs"
                        data-testid="locacao-doc-anexo"
                      >
                        <button
                          type="button"
                          className="inline-flex max-w-[12rem] items-center gap-1 truncate text-primary underline"
                          onClick={() =>
                            void abrirDocumento(a.id).catch((e) =>
                              toast.error(errorMessage(e, "Documento indisponível.")),
                            )
                          }
                        >
                          <Paperclip className="h-3 w-3 shrink-0" /> {a.nomeArquivo}
                        </button>
                        {itemLidoPorIa(a.item) ? (
                          <SeloIa doc={a} lendo={!!lendo[a.id]} />
                        ) : (
                          <SeloIa doc={{ ...a, leitura: "sem_leitura" }} lendo={false} />
                        )}
                        {editavel &&
                          itemLidoPorIa(a.item) &&
                          !lendo[a.id] &&
                          a.leitura !== "pendente" && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-primary"
                              aria-label={`Ler de novo ${a.nomeArquivo}`}
                              title={a.leitura === "ok" ? "Ler de novo" : "Tentar de novo"}
                              disabled={ocupado}
                              onClick={() => void ler(a.id)}
                            >
                              <RotateCcw className="h-3 w-3" />
                              {a.leitura === "falhou" ? "tentar de novo" : a.leitura ? "" : "ler"}
                            </button>
                          )}
                        {editavel && (
                          <button
                            type="button"
                            aria-label={`Remover ${a.nomeArquivo}`}
                            className="text-destructive"
                            onClick={() =>
                              void rodar(() => removerDocumento(a.id), "Documento removido")
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="border-t pt-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <b>Dados do contrato</b>
          <span className="text-xs text-muted-foreground">
            A IA preenche só o que está vazio; o que você digita nunca é trocado. Confira tudo antes
            de enviar.
          </span>
        </div>
        {!d.contrato.exige &&
          aviso(
            "blue",
            <>
              Nesta locação ({d.tipo === "comercial" ? "comercial" : GARANTIA_LABEL[d.garantia]}) os
              dados abaixo ajudam o setor de contratos, mas <b>não travam</b> o envio (por enquanto
              a trava vale só para residencial com fiador).
            </>,
          )}
        <DadosContrato
          d={d}
          editavel={editavel}
          valores={form}
          origem={origem}
          onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
        />
        {editavel && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="outline"
              disabled={ocupado || !sujo}
              onClick={() =>
                void salvar()
                  .then(recarregar)
                  .catch((e) => toast.error(errorMessage(e, "Não foi possível salvar.")))
              }
            >
              <Save className="mr-1 h-4 w-4" /> Salvar dados do contrato
            </Button>
          </div>
        )}
      </div>

      {editavel && (
        <div className="space-y-2" data-testid="locacao-trava">
          {d.faltando.length > 0 &&
            aviso(
              "red",
              <>
                🔒 <b>Trava:</b> faltam {d.faltando.length} documento(s). Não é possível enviar à
                gestora com pendência.
              </>,
            )}
          {faltasDados.length > 0 &&
            aviso(
              "amber",
              <>
                🔒 <b>Falta preencher ({faltasDados.length}):</b> {faltasDados.join(", ")}.
              </>,
            )}
          {!d.faltando.length &&
            !faltasDados.length &&
            aviso("green", <>Tudo anexado e preenchido. Pode enviar para conferência.</>)}
        </div>
      )}
      {editavel && (
        <div className="flex justify-end">
          <Button
            disabled={
              ocupado || d.faltando.length > 0 || faltasDados.length > 0 || invalidos.length > 0
            }
            onClick={() =>
              void rodar(async () => {
                await salvar(true);
                await enviarDocumentacao(d.id);
              }, "Documentação enviada para conferência")
            }
          >
            <Send className="mr-1 h-4 w-4" /> Enviar documentação à gestora
          </Button>
        </div>
      )}
    </div>
  );
}

/** Resumo para a gestora na Conferência: os mesmos campos, só leitura, com a origem de cada um. */
export function ContratoConferencia({ d }: { d: Detalhe }) {
  const { valores, origem } = lerContrato(d.contrato.valores, d.contrato.origem);
  return (
    <details className="rounded-md border p-2" open>
      <summary className="cursor-pointer text-sm font-medium">
        Dados do contrato
        {d.contrato.faltando.length ? ` — falta ${d.contrato.faltando.length}` : ""}
      </summary>
      <div className="mt-2">
        <DadosContrato d={d} editavel={false} valores={valores} origem={origem} />
      </div>
    </details>
  );
}
