import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, FileUp, KeyRound, Paperclip, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListSkeleton, Pill } from "@/components/visual/base";
import { LocacaoStepper } from "@/components/locacao/LocacaoStepper";
import { ContratoConferencia, LocacaoDocumentacao } from "@/components/locacao/LocacaoDocumentacao";
import { LocacaoMontarContrato } from "@/components/locacao/LocacaoMontarContrato";
import { ChecklistPartes } from "@/components/locacao/LocacaoChecklist";
import { FichaAbertura } from "@/components/locacao/LocacaoFicha";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import {
  ENVELOPE_LABEL,
  ordemAssinatura,
  ETAPAS,
  GARANTIA_LABEL,
  MINUTA_LABEL,
  MOBILIA_LABEL,
  PAPEL_LABEL,
  SERVICOS,
  brl,
  calcularComissao,
  dataBr,
  dataPagamento,
  diasParado,
  etapaIndex,
  lerContexto,
  lerDetalhe,
  textoParado,
  titularidadePendente,
  tomParado,
  type ContextoLocacao,
  type LocacaoDetalhe as Detalhe,
} from "@/lib/locacao";
import {
  abrirDocumento,
  contextoLocacao,
  contratosAcao,
  corretorMinuta,
  detalheLocacao,
  enviarProtocolo,
  gestoraDecidir,
  posAcao,
} from "@/lib/locacao-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

function Aviso({
  tom,
  children,
}: {
  tom: "blue" | "amber" | "red" | "green";
  children: ReactNode;
}) {
  const cor = {
    blue: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
    amber:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    red: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
    green:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  }[tom];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cor}`}>{children}</div>;
}

/** Marca de regra ainda não confirmada por Denis. */
export function AConfirmar() {
  return (
    <span className="ml-1 rounded border border-dashed border-amber-500 px-1 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300">
      a confirmar
    </span>
  );
}

export function LocacaoDetalhe({ id }: { id: string }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [ctx, setCtx] = useState<ContextoLocacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vendo, setVendo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [det, c] = await Promise.all([detalheLocacao(id), contextoLocacao()]);
      setD(lerDetalhe(det));
      setCtx(lerContexto(c));
      setErro(null);
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível abrir a locação."));
    }
  }, [id]);

  useEffect(() => {
    setD(null);
    setVendo(null);
    void carregar();
  }, [carregar]);

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
  if (!d || !ctx) return <ListSkeleton />;

  const rodar = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setVendo(null);
      await carregar();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  };

  const atual = etapaIndex(d.etapa);
  const ver = vendo ?? atual;
  const souCorretor = d.corretorId === ctx.usuarioId || ctx.admin;
  const tenho = (p: "gestora" | "contratos" | "vistoria") => ctx.papeis.includes(p);
  const dias = diasParado(d.etapaDesde);
  const props = { d, ctx, busy, rodar };

  let corpo: ReactNode;
  const e = ETAPAS[ver].key;
  if (d.situacao === "encerrada") {
    corpo = (
      <Aviso tom="red">Locação encerrada: {d.motivoDevolucao ?? "sem motivo registrado"}.</Aviso>
    );
  } else if (ver > atual) {
    corpo = (
      <Aviso tom="blue">
        Etapa futura. Será liberada quando a etapa “{ETAPAS[atual].label}” terminar.
      </Aviso>
    );
  } else if (e === "pre_analise") {
    corpo = (
      <FichaAbertura
        {...props}
        editavel={ver === atual && souCorretor}
        aConfirmar={<AConfirmar />}
        aviso={
          <Aviso tom="blue">
            Ficha de abertura preenchida pelo <b>corretor</b>. Nesta etapa{" "}
            <b>não se pede documento</b>: só os dados para a gestora aprovar ou não.
          </Aviso>
        }
      />
    );
  } else if (e === "documentacao") {
    corpo = (
      <LocacaoDocumentacao
        {...props}
        recarregar={carregar}
        editavel={ver === atual && souCorretor && d.etapa === "documentacao"}
        aviso={(tom, c) => <Aviso tom={tom}>{c}</Aviso>}
      />
    );
  } else if (e === "aprovacao" || e === "conferencia") {
    corpo =
      ver === atual ? (
        tenho("gestora") ? (
          <DecisaoGestora {...props} />
        ) : (
          <Aviso tom="blue">
            Aguardando a gestora de locação{" "}
            {e === "aprovacao" ? "aprovar a pré-análise" : "conferir a documentação"} (
            {textoParado(dias)}). O corretor só acompanha.
          </Aviso>
        )
      ) : (
        <Aviso tom="green">Concluída pela gestora.</Aviso>
      );
  } else if (e === "minuta") {
    corpo =
      ver === atual ? (
        <Minuta {...props} souCorretor={souCorretor} contratos={tenho("contratos")} />
      ) : (
        <Aviso tom="green">Minuta aprovada{d.minuta.modelo ? ` (${d.minuta.modelo})` : ""}.</Aviso>
      );
  } else if (e === "assinatura") {
    corpo = <Assinatura {...props} contratos={ver === atual && tenho("contratos")} />;
  } else if (e === "pos_assinatura" || e === "chaves") {
    corpo = (
      <PosAssinatura
        {...props}
        vistoria={ver === atual && tenho("vistoria")}
        souCorretor={souCorretor && ver === atual}
      />
    );
  } else {
    corpo = <ComissaoResumo d={d} ctx={ctx} souCorretor={souCorretor} busy={busy} rodar={rodar} />;
  }

  return (
    <div className="space-y-4 max-md:pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/locacoes">
            <ArrowLeft className="mr-1 h-4 w-4" /> Locações
          </Link>
        </Button>
        <h1 className="text-lg font-semibold sm:text-xl">
          {d.codigo} · {d.candidato.nome || "Nova locação"}
        </h1>
        <span className="flex-1" />
        <Pill tom={d.devolvida ? "amber" : d.etapa === "comissao" ? "green" : "blue"}>
          {ETAPAS[atual].label}
          {d.devolvida ? " · devolvida" : ""}
          {d.etapa === "minuta" && d.minuta.estado
            ? ` · ${MINUTA_LABEL[d.minuta.estado] ?? d.minuta.estado}`
            : ""}
        </Pill>
        <Pill tom={tomParado(dias)}>parado {textoParado(dias)}</Pill>
      </div>
      <p className="text-sm text-muted-foreground">
        Corretor responsável: {d.corretorNome}
        {d.captadorNome ? ` · Captador: ${d.captadorNome}` : ""}
        {d.coordenadorNome ? ` · Coordenador: ${d.coordenadorNome}` : ""} ·{" "}
        {d.ficha.imovelId ? `${d.ficha.imovelId} · ` : ""}
        {d.endereco || "imóvel não informado"}
      </p>
      <Card>
        <CardContent className="space-y-4 pt-4">
          <LocacaoStepper
            etapa={d.etapa}
            devolvida={d.devolvida}
            etapaDesde={d.etapaDesde}
            vendo={ver}
            onVer={(i) => setVendo(i === atual ? null : i)}
          />
          {d.devolvida && d.motivoDevolucao && (
            <Aviso tom="amber">
              <b>Devolvida pela gestora:</b> {d.motivoDevolucao}
            </Aviso>
          )}
          {atual >= etapaIndex("documentacao") && d.situacao === "ativa" && (
            <ChecklistPartes d={d} />
          )}
          <div className="border-t pt-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <b>
                Etapa {ver + 1} — {ETAPAS[ver].label}
              </b>
              <span className="text-xs text-muted-foreground">
                Responsável: {PAPEL_LABEL[ETAPAS[ver].papel]}
                {ctx.pessoas[ETAPAS[ver].papel]?.length
                  ? ` · ${ctx.pessoas[ETAPAS[ver].papel].join(", ")}`
                  : ""}
              </span>
            </div>
            {corpo}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico (data e responsável de cada passo)</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5 text-sm" data-testid="locacao-historico">
            {[...d.eventos].reverse().map((ev, i) => (
              <li key={i} className="pl-1">
                <b>{new Date(ev.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</b>{" "}
                — {ev.descricao}{" "}
                <span className="text-xs text-muted-foreground">
                  · {PAPEL_LABEL[ev.papel as keyof typeof PAPEL_LABEL] ?? ev.papel}
                  {ev.atorNome ? ` (${ev.atorNome})` : ""}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

type P = {
  d: Detalhe;
  ctx: ContextoLocacao;
  busy: boolean;
  rodar: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
};

// Etapas 2 e 4 ------------------------------------------------------------------------------------------------
function DecisaoGestora({ d, ctx, busy, rodar }: P) {
  const [motivo, setMotivo] = useState("");
  const pre = d.etapa === "aprovacao";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <b>Candidato:</b> {d.candidato.nome}
          <br />
          CPF {d.candidato.cpf} · nasc. {dataBr(d.candidato.nascimento)}
          <br />
          {d.candidato.telefone} · {d.candidato.email}
        </div>
        <div>
          <b>Imóvel:</b> {d.endereco} ({d.tipo})
          <br />
          Aluguel {brl(d.aluguel)} · Cond. {brl(d.condominio)} · IPTU {brl(d.iptu)}
          <br />
          Garantia: <b>{GARANTIA_LABEL[d.garantia]}</b> · Taxa adm. {d.taxaAdm}%
          {d.parceria ? " · com parceria" : ""}
          {d.ficha.garantiaOutra ? ` · outra: ${d.ficha.garantiaOutra}` : ""}
        </div>
      </div>
      {pre && (
        <div
          className="grid grid-cols-1 gap-3 rounded-md border p-2 text-sm md:grid-cols-2"
          data-testid="locacao-ficha-resumo"
        >
          <div>
            <b>Ficha:</b> {d.ficha.imovelId || "—"} ·{" "}
            {d.ficha.mobilia ? MOBILIA_LABEL[d.ficha.mobilia] : "mobília —"} ·{" "}
            {d.ficha.metragem ? `${d.ficha.metragem} m²` : "metragem —"}
            <br />
            Locatário {d.ficha.locatarioPessoa.toUpperCase()} · mora em{" "}
            {d.ficha.locatarioEndereco || "—"}
            <br />
            Proprietário {d.ficha.proprietarioPessoa.toUpperCase()}:{" "}
            {d.ficha.proprietario.nome || "—"}
            {d.ficha.proprietario.telefone ? ` · ${d.ficha.proprietario.telefone}` : ""}
            {d.ficha.proprietario.email ? ` · ${d.ficha.proprietario.email}` : ""}
          </div>
          <div>
            <b>Corretores:</b> responsável {d.corretorNome} · captador {d.captadorNome ?? "—"}
            {d.ficha.observacoes && (
              <>
                <br />
                <b>Observações:</b> {d.ficha.observacoes}
              </>
            )}
          </div>
        </div>
      )}
      {!pre && (
        <div className="space-y-1 text-sm">
          {d.checklist.map((item) => {
            const a = d.documentos.filter((x) => x.item === item);
            return (
              <div key={item} className="flex flex-wrap items-center gap-2">
                <span aria-hidden>{a.length ? "📄" : "❌"}</span> {item}
                {a.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() =>
                      void abrirDocumento(x.id).catch((e) =>
                        toast.error(errorMessage(e, "Documento indisponível.")),
                      )
                    }
                  >
                    abrir
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {!pre && <ContratoConferencia d={d} />}
      <div className="space-y-1">
        <Label htmlFor="motivo-gestora">Motivo (obrigatório para reprovar/devolver)</Label>
        <Textarea
          id="motivo-gestora"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: renda insuficiente para o valor; fiador sem imóvel quitado..."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={busy || motivo.trim().length < 5}
          onClick={() =>
            void rodar(
              () => gestoraDecidir(d.id, false, motivo),
              pre ? "Pré-análise reprovada" : "Devolvida ao corretor",
            )
          }
        >
          {pre ? "Reprovar" : "Devolver ao corretor"}
        </Button>
        <span className="flex-1" />
        <Button
          disabled={busy}
          onClick={() =>
            void rodar(
              () => gestoraDecidir(d.id, true, null),
              pre ? "Pré-análise aprovada" : "Enviada ao setor de contratos",
            )
          }
        >
          {pre ? "Aprovar pré-análise" : "Ok — enviar ao setor de contratos"}
        </Button>
      </div>
      {pre && (
        <p className="text-xs text-muted-foreground">
          Reprovada{" "}
          {ctx.config.reprovadaVoltaAoCorretor
            ? "volta ao corretor para corrigir"
            : "encerra a locação"}
          .
          <AConfirmar />
        </p>
      )}
    </div>
  );
}

// Etapa 5 -----------------------------------------------------------------------------------------------------
function Minuta({
  d,
  busy,
  rodar,
  souCorretor,
  contratos,
}: P & { souCorretor: boolean; contratos: boolean }) {
  const [texto, setTexto] = useState("");
  const m = d.minuta;
  const modelo = `${d.tipo === "comercial" ? "Comercial" : "Residencial"} — ${GARANTIA_LABEL[d.garantia]}`;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Modelo sugerido: <b>Minuta {modelo}</b> (tipo do imóvel × garantia).
        {m.externa && (
          <Pill tom="violet" className="ml-2">
            minuta de outra RE/MAX
          </Pill>
        )}
      </p>
      {m.estado === "pendencia" && (
        <Aviso tom="amber">
          📌 <b>Setor de contratos cobrou pendência:</b> {m.pendencia}
        </Aviso>
      )}
      {m.estado === "com_corretor" && (
        <Aviso tom="blue">📄 Minuta enviada ao corretor para conferir com o proprietário.</Aviso>
      )}
      {m.estado === "ajuste" && (
        <Aviso tom="amber">
          ✏️ Minuta <b>em ajuste</b> desde {dataBr(m.ajusteData)} — {m.ajusteMotivo}
        </Aviso>
      )}
      {m.estado === "aprovada" && (
        <Aviso tom="green">
          Minuta aprovada pelo corretor/proprietário. Pronta para assinatura.
        </Aviso>
      )}
      {m.estado === "elaborando" && (
        <Aviso tom="blue">Setor de contratos elaborando a minuta.</Aviso>
      )}

      {souCorretor && (m.estado === "pendencia" || m.estado === "com_corretor") && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="texto-corretor">
            {m.estado === "pendencia"
              ? "Resposta da pendência"
              : "Ajuste pedido pelo proprietário (se houver)"}
          </Label>
          <Input id="texto-corretor" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {m.estado === "pendencia" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void rodar(
                    () => corretorMinuta(d.id, "resolver_pendencia", texto),
                    "Pendência devolvida ao setor de contratos",
                  )
                }
              >
                Resolver pendência
              </Button>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void rodar(() => corretorMinuta(d.id, "de_acordo"), "Minuta aprovada")
                  }
                >
                  Proprietário de acordo
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || texto.trim().length < 5}
                  onClick={() =>
                    void rodar(
                      () => corretorMinuta(d.id, "pedir_ajuste", texto),
                      "Minuta marcada como em ajuste",
                    )
                  }
                >
                  Pedir ajuste
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {contratos && <LocacaoMontarContrato d={d} />}
      {contratos && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Setor de contratos</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={m.externa}
              disabled={busy}
              onChange={(e) =>
                void rodar(
                  () => contratosAcao(d.id, "minuta_externa", { externa: e.target.checked }),
                  "Atalho atualizado",
                )
              }
            />
            ⚡ <b>Atalho:</b> minuta já veio pronta de outra RE/MAX (pular elaboração)
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label htmlFor="texto-contratos">Pendência a cobrar / motivo do ajuste</Label>
              <Input
                id="texto-contratos"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || texto.trim().length < 5}
              onClick={() =>
                void rodar(
                  () => contratosAcao(d.id, "cobrar_pendencia", { texto }),
                  "Pendência aparece na esteira do corretor",
                )
              }
            >
              Cobrar pendência
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void rodar(
                  () => contratosAcao(d.id, "marcar_ajuste", { texto }),
                  "Minuta marcada como em ajuste",
                )
              }
            >
              Marcar “em ajuste”
            </Button>
          </div>
          {!d.docsCompleta && (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
              data-testid="locacao-trava-contrato"
            >
              🔒 <b>Montar contrato travado.</b> Faltam {d.faltando.length} documento(s)
              obrigatório(s): {d.faltando.join("; ")}. Use “Cobrar pendência” para avisar o
              corretor.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !d.docsCompleta}
              title={!d.docsCompleta ? "Travado: falta documento obrigatório" : undefined}
              onClick={() =>
                void rodar(() => contratosAcao(d.id, "enviar_minuta"), "Minuta enviada ao corretor")
              }
            >
              {m.externa
                ? "Enviar minuta externa ao corretor"
                : "Montar e enviar minuta ao corretor"}
            </Button>
            <span className="flex-1" />
            <Button
              disabled={busy || !d.docsCompleta || !(m.estado === "aprovada" || m.externa)}
              onClick={() =>
                void rodar(
                  () => contratosAcao(d.id, "preparar_assinatura"),
                  "Pronta para assinatura",
                )
              }
            >
              Preparar assinatura →
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            “Preparar assinatura” libera quando a minuta está aprovada (ou quando veio pronta de
            outra RE/MAX).
          </p>
        </div>
      )}
    </div>
  );
}

// Etapa 6 -----------------------------------------------------------------------------------------------------
function Assinatura({ d, busy, rodar, contratos }: P & { contratos: boolean }) {
  const a = d.assinatura;
  const [junto, setJunto] = useState(false);
  const st = (v: string) =>
    v === "assinado" ? (
      <Pill tom="green">assinado</Pill>
    ) : v === "pendente" ? (
      <Pill tom="amber">aguardando assinaturas</Pill>
    ) : (
      <Pill tom="slate">não enviado</Pill>
    );
  const ordem = ordemAssinatura(d.garantia);
  const quem = {
    adm: "Proprietário (+ cônjuge)",
    loc: ordem.join(" → "),
    vist: "Proprietário e locatário",
  };
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Documento</th>
              <th>Quem assina</th>
              <th>Situação</th>
              {contratos && <th />}
            </tr>
          </thead>
          <tbody>
            {(["adm", "loc", "vist"] as const).map((k) => (
              <tr key={k} className="border-t">
                <td className="py-1.5">{ENVELOPE_LABEL[k]}</td>
                <td className="text-xs">{quem[k]}</td>
                <td>
                  {k === "vist" && !a.vistJunto && a.vist === "nao" ? (
                    <Pill tom="slate">vai depois (pós-assinatura)</Pill>
                  ) : (
                    st(a[k])
                  )}
                </td>
                {contratos && (
                  <td>
                    {a[k] === "pendente" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void rodar(
                            () => contratosAcao(d.id, "marcar_assinado", { documento: k }),
                            "Assinatura registrada",
                          )
                        }
                      >
                        marcar assinado
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.enviadoEm && (
        <p className="text-xs text-muted-foreground">Envio registrado em {dataBr(a.enviadoEm)}.</p>
      )}
      {contratos && !a.enviadoEm && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={junto} onChange={(e) => setJunto(e.target.checked)} />
            Chave já está na imobiliária → mandar a <b>vistoria junto</b> (3º documento)
          </label>
          <div className="flex justify-end">
            <Button
              disabled={busy}
              onClick={() =>
                void rodar(
                  () => contratosAcao(d.id, "registrar_envio", { vist_junto: junto }),
                  "Envio para assinatura registrado",
                )
              }
            >
              Registrar envio para assinatura (DocuSign)
            </Button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Ordem de assinatura: {ordem.join(" → ")}.</p>
      <Aviso tom="amber">
        Fase 1: o envio é feito no <b>DocuSign</b>, fora do sistema, e <b>registrado aqui à mão</b>.
        A ligação automática fica para a próxima fase.
      </Aviso>
    </div>
  );
}

// Etapas 7 e 8 ------------------------------------------------------------------------------------------------
function PosAssinatura({
  d,
  ctx,
  busy,
  rodar,
  vistoria,
  souCorretor,
}: P & { vistoria: boolean; souCorretor: boolean }) {
  const p = d.pos;
  const [apolice, setApolice] = useState(p.apolice ?? "");
  const [mudanca, setMudanca] = useState(p.mudanca ?? "");
  const [chave, setChave] = useState(hojeSaoPaulo());
  const [prot, setProt] = useState<Record<string, string>>(() => ({
    cpfl: p.tit.cpfl.protocolo ?? "",
    saae: p.tit.saae.protocolo ?? "",
    gas: p.tit.gas.protocolo ?? "",
  }));
  const acao = (a: string, ok: string, dados: Record<string, unknown> = {}) =>
    void rodar(() => posAcao(d.id, a, dados), ok);
  const Item = ({
    ok,
    children,
    extra,
  }: {
    ok: boolean;
    children: ReactNode;
    extra?: ReactNode;
  }) => (
    <div className="flex flex-wrap items-center gap-2 py-1 text-sm">
      <span aria-hidden>{ok ? "✅" : "⬜"}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {extra}
    </div>
  );
  const btn = (a: string, ok: string, disabled = false) =>
    vistoria ? (
      <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => acao(a, ok)}>
        registrar hoje
      </Button>
    ) : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Vistoria</CardTitle>
          </CardHeader>
          <CardContent>
            <Item
              ok={!!p.vistoriaPedida}
              extra={
                p.vistoriaPedida ? (
                  <span className="text-xs">{dataBr(p.vistoriaPedida)}</span>
                ) : (
                  btn("vistoria_pedida", "Vistoria pedida")
                )
              }
            >
              Vistoria pedida
            </Item>
            <Item
              ok={!!p.laudoEm}
              extra={
                p.laudoEm ? (
                  <span className="text-xs">{dataBr(p.laudoEm)}</span>
                ) : (
                  btn("laudo_assinado", "Laudo registrado", !p.vistoriaPedida && !p.vistJunto)
                )
              }
            >
              Laudo enviado p/ assinatura e assinado{p.vistJunto ? " (foi junto do contrato)" : ""}
            </Item>
            <Item
              ok={true}
              extra={
                p.contestacaoEm ? (
                  <Pill tom="amber">contestada {dataBr(p.contestacaoEm)}</Pill>
                ) : vistoria ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => acao("contestacao", "Contestação registrada")}
                  >
                    registrar contestação
                  </Button>
                ) : null
              }
            >
              Contestação de vistoria
            </Item>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">
              Seguro e condomínio{" "}
              {ctx.config.seguroIncendioObrigatorio && <Pill tom="red">seguro obrigatório</Pill>}
              <AConfirmar />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Item
              ok={!!p.seguroEm}
              extra={
                p.seguroEm ? (
                  <span className="text-xs">
                    {dataBr(p.seguroEm)} · {p.apolice ?? "sem apólice"}
                  </span>
                ) : vistoria ? (
                  <span className="flex items-center gap-1">
                    <Input
                      className="h-8 w-32"
                      placeholder="nº apólice"
                      value={apolice}
                      onChange={(e) => setApolice(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => acao("seguro", "Seguro registrado", { apolice })}
                    >
                      registrar
                    </Button>
                  </span>
                ) : null
              }
            >
              Seguro (incêndio/fiança) contratado
            </Item>
            <Item
              ok={!!p.condominioAviso || p.semCondominio}
              extra={
                p.semCondominio ? (
                  <Pill tom="slate">sem condomínio</Pill>
                ) : p.condominioAviso ? (
                  <span className="text-xs">{dataBr(p.condominioAviso)}</span>
                ) : vistoria ? (
                  <span className="flex gap-1">
                    {btn("condominio_aviso", "Condomínio avisado")}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => acao("sem_condominio", "Marcado sem condomínio")}
                    >
                      sem condomínio
                    </Button>
                  </span>
                ) : null
              }
            >
              Aviso ao condomínio
            </Item>
            <Item
              ok={!!p.mudanca || p.semCondominio}
              extra={
                vistoria && !p.semCondominio ? (
                  <span className="flex items-center gap-1">
                    <Input
                      type="date"
                      className="h-8 w-40"
                      value={mudanca}
                      onChange={(e) => setMudanca(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !mudanca}
                      onClick={() => acao("mudanca", "Mudança agendada", { data: mudanca })}
                    >
                      salvar
                    </Button>
                  </span>
                ) : (
                  <span className="text-xs">{dataBr(p.mudanca)}</span>
                )
              }
            >
              Agendamento de mudança
            </Item>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Troca de titularidade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {SERVICOS.map((s) => {
              const t = p.tit[s.key];
              return (
                <div key={s.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span aria-hidden>{!t.aplica ? "➖" : t.protocolo ? "✅" : "⚠️"}</span>
                  <span className="w-28">{s.label}</span>
                  {!t.aplica ? (
                    <span className="text-xs text-muted-foreground">não se aplica</span>
                  ) : souCorretor ? (
                    <span className="flex items-center gap-1">
                      <Input
                        className="h-8 w-40"
                        placeholder="nº do protocolo"
                        value={prot[s.key]}
                        onChange={(e) => setProt((x) => ({ ...x, [s.key]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || prot[s.key] === (t.protocolo ?? "")}
                        onClick={() =>
                          void rodar(
                            () => enviarProtocolo(d.id, s.key, prot[s.key]),
                            `Protocolo ${s.label} enviado`,
                          )
                        }
                      >
                        enviar
                      </Button>
                    </span>
                  ) : (
                    <span className="text-xs">
                      {t.protocolo
                        ? `protocolo ${t.protocolo} (enviado pelo corretor)`
                        : "aguardando protocolo do corretor"}
                    </span>
                  )}
                  {vistoria && (
                    <label className="ml-auto flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={!t.aplica}
                        disabled={busy}
                        onChange={(e) =>
                          void rodar(
                            () =>
                              posAcao(d.id, "titularidade_aplica", {
                                servico: s.key,
                                aplica: !e.target.checked,
                              }),
                            "Atualizado",
                          )
                        }
                      />
                      não se aplica
                    </label>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Protocolos enviados pelo corretor. Falta de protocolo <b>não trava</b> nada — só gera
              alerta na comissão.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">🔑 Entrega das chaves</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.etapa === "pos_assinatura" && vistoria && (
              <Button
                variant="outline"
                className="h-auto w-full whitespace-normal py-2 text-left sm:w-auto"
                disabled={busy}
                onClick={() => acao("pronto_para_chaves", "Pronto para entregar as chaves")}
              >
                Pós-assinatura concluída → combinar entrega das chaves
              </Button>
            )}
            {d.etapa === "chaves" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Data combinada com o corretor ({d.corretorNome}).
                </p>
                {vistoria && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      className="h-9 w-44"
                      value={chave}
                      onChange={(e) => setChave(e.target.value)}
                    />
                    <Button
                      disabled={busy || !chave}
                      onClick={() =>
                        void rodar(async () => {
                          const r = await posAcao(d.id, "entregar_chaves", { data: chave });
                          if (r?.alerta)
                            toast.warning(
                              "Chave entregue com o laudo de vistoria ainda sem assinatura.",
                            );
                        }, "Chave entregue — entra na comissão do mês seguinte")
                      }
                    >
                      <KeyRound className="mr-1 h-4 w-4" /> Registrar entrega
                    </Button>
                  </div>
                )}
              </>
            )}
            {!p.laudoEm && (
              <Aviso tom="amber">
                Laudo de vistoria ainda não assinado.{" "}
                {ctx.config.chaveAntesDoLaudo
                  ? "A chave pode ser entregue mesmo assim (fica registrado o alerta)."
                  : "A entrega da chave fica bloqueada até o laudo."}
                <AConfirmar />
              </Aviso>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Etapa 9 -----------------------------------------------------------------------------------------------------
function ComissaoResumo({ d, ctx, souCorretor, busy, rodar }: P & { souCorretor: boolean }) {
  const r = calcularComissao(d, ctx.config);
  const pend = titularidadePendente(d.pos.tit);
  return (
    <div className="space-y-2">
      <Aviso tom="green">
        Chaves entregues em <b>{dataBr(d.chaveEm)}</b>. Comissão prevista para o corretor:{" "}
        <b>{brl(r.corretor)}</b> · pagamento {dataBr(dataPagamento(d.chaveEm, ctx.config))}{" "}
        <AConfirmar />
      </Aviso>
      {pend.length > 0 && (
        <Aviso tom="amber">
          ⚠️ Titularidade ainda sem protocolo de {pend.join(", ")}. Isso <b>não bloqueia</b> a
          comissão, só alerta.
        </Aviso>
      )}
      {souCorretor && pend.length > 0 && (
        <PosAssinatura d={d} ctx={ctx} busy={busy} rodar={rodar} vistoria={false} souCorretor />
      )}
    </div>
  );
}
