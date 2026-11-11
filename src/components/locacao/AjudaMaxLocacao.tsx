/**
 * Ajuda MAX na Locação (t_b037935e + t_365484dc; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
 * Balão fixo no canto inferior direito, só nas telas /locacoes e só com a chave "ajuda_max_locacao" + Locação
 * ligadas na imobiliária. Três modos, como na maquete:
 *  - Dúvida de uso: ensina a usar a tela (IA). Não lê nem envia dados de locações, clientes ou contratos. Se não
 *    souber, o servidor registra a pergunta como "dúvida sem resposta" e a pessoa é avisada.
 *  - Dar ideia / Relatar erro: registra o envio (chamado da Locação) com print opcional e tarja. O print NUNCA vai à IA.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Bug,
  Eraser,
  ImagePlus,
  Lightbulb,
  MessageCircleQuestion,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  EditorTarja,
  carregarImagem,
  exportarPrint,
  type Tarja,
} from "@/components/AjudaSugestoes";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { PRINT_MAX_BYTES } from "@/lib/ajuda-sugestoes";
import {
  LIMITE_DIA,
  PERGUNTA_MAX,
  PERGUNTA_MIN,
  SUGESTOES,
  TEXTO_INDISPONIVEL,
  TEXTO_LIMITE,
  formatarResposta,
  lerUso,
  telaDaRota,
  type Linha,
  type Mensagem,
} from "@/lib/ajuda-max-locacao";
import {
  TEXTO_DUVIDA_NAO_REGISTRADA,
  TEXTO_MAX,
  TEXTO_MIN,
  confirmacaoEnvio,
  origemDoEnvio,
} from "@/lib/ajuda-max-locacao-sugestoes";
import { perguntarAjudaMaxLocacao } from "@/lib/ajuda-max-locacao.functions";
import { registrarEnvioLocacao } from "@/lib/ajuda-max-locacao-sugestoes.functions";

const db = supabase as unknown as SupabaseClient;

type Item = Mensagem & { id: number; aviso?: boolean; ok?: boolean };
type Modo = "uso" | "sugestao" | "erro";

const MODOS: { modo: Modo; label: string; icon: typeof Bug }[] = [
  { modo: "uso", label: "Dúvida de uso", icon: MessageCircleQuestion },
  { modo: "sugestao", label: "Dar ideia", icon: Lightbulb },
  { modo: "erro", label: "Relatar erro", icon: Bug },
];

const PLACEHOLDER: Record<Modo, string> = {
  uso: "Pergunte como usar…",
  sugestao: "Qual é a sua ideia?",
  erro: "O que aconteceu?",
};

function Trechos({ linha }: { linha: Linha }) {
  return (
    <>
      {linha.trechos.map((t, i) =>
        t.negrito ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : (
          <span key={i}>{t.texto}</span>
        ),
      )}
    </>
  );
}

function TextoResposta({ texto }: { texto: string }) {
  return (
    <div className="space-y-1.5 break-words">
      {formatarResposta(texto).map((l, i) =>
        l.tipo === "p" ? (
          <p key={i}>
            <Trechos linha={l} />
          </p>
        ) : (
          <div key={i} className="flex gap-1.5">
            <span className="shrink-0 font-semibold text-primary">
              {l.tipo === "num" ? `${l.n}.` : "•"}
            </span>
            <span className="min-w-0">
              <Trechos linha={l} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

export function AjudaMaxLocacao() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tela = telaDaRota(pathname);
  const perguntar = useServerFn(perguntarAjudaMaxLocacao);
  const registrar = useServerFn(registrarEnvioLocacao);
  const [ligado, setLigado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<Modo>("uso");
  const [usadas, setUsadas] = useState(0);
  const [limite, setLimite] = useState(LIMITE_DIA);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tarjas, setTarjas] = useState<Tarja[]>([]);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const seq = useRef(0);
  const fim = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A chave é conferida pelo banco (Locação + ajuda_max_locacao da imobiliária de quem está logado).
  useEffect(() => {
    if (!tela) return;
    let vivo = true;
    db.rpc("ajuda_max_locacao_uso_hoje").then(({ data, error }) => {
      if (!vivo) return;
      const u = lerUso(error ? null : data);
      setLigado(u.ligado);
      setUsadas(u.usadas);
      setLimite(u.limite);
    });
    return () => {
      vivo = false;
    };
  }, [tela]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [itens, enviando]);

  if (!tela || !ligado) return null;
  const esgotado = usadas >= limite;
  const travado = modo === "uso" && esgotado;
  const minimo = modo === "uso" ? PERGUNTA_MIN : TEXTO_MIN;
  const maximo = modo === "uso" ? PERGUNTA_MAX : TEXTO_MAX;

  const adicionar = (papel: Item["papel"], t: string, extra: Partial<Item> = {}) =>
    setItens((xs) => [...xs, { id: ++seq.current, papel, texto: t, ...extra }]);

  const trocarModo = (m: Modo) => {
    setModo(m);
    setErroForm(null);
    if (m === "uso") {
      setImg(null);
      setTarjas([]);
    }
  };

  const perguntarIA = async (pergunta: string) => {
    const p = pergunta.trim();
    if (enviando || p.length < PERGUNTA_MIN || esgotado) return;
    // Só as trocas normais vão como histórico (avisos do sistema e registros não).
    const historico = itens
      .filter((i) => !i.aviso && !i.ok)
      .map(({ papel, texto: t }) => ({ papel, texto: t }));
    adicionar("usuario", p);
    setTexto("");
    setEnviando(true);
    try {
      const r = await perguntar({ data: { pergunta: p, tela, historico: historico.slice(-4) } });
      setUsadas(r.usadas);
      setLimite(r.limite);
      if (!r.ok) adicionar("assistente", r.mensagem, { aviso: true });
      else if (r.sabe) adicionar("assistente", r.resposta);
      else {
        adicionar("assistente", r.resposta, { aviso: true });
        if (r.duvida?.registrada)
          adicionar(
            "assistente",
            confirmacaoEnvio("duvida", { numero: r.duvida.numero, telaNome: "", comPrint: false }),
            { ok: true },
          );
        else if (r.duvida) adicionar("assistente", TEXTO_DUVIDA_NAO_REGISTRADA, { aviso: true });
      }
    } catch {
      adicionar("assistente", TEXTO_INDISPONIVEL, { aviso: true });
    } finally {
      setEnviando(false);
    }
  };

  const enviarRegistro = async (tipo: "sugestao" | "erro") => {
    const t = texto.trim();
    if (enviando) return;
    if (t.length < TEXTO_MIN) {
      setErroForm(`Escreva pelo menos ${TEXTO_MIN} caracteres.`);
      return;
    }
    setErroForm(null);
    setEnviando(true);
    const origem = origemDoEnvio(pathname);
    const comPrint = !!img;
    try {
      const r = await registrar({
        data: {
          tipo,
          texto: t,
          telaRota: origem.telaRota,
          telaNome: origem.telaNome,
          userAgent: navigator.userAgent.slice(0, 400),
          print: img
            ? { base64: exportarPrint(img, tarjas), contentType: "image/jpeg" }
            : undefined,
        },
      });
      adicionar(
        "usuario",
        `${tipo === "erro" ? "Erro" : "Ideia"}: ${t}${comPrint ? " 📎 print" : ""}`,
      );
      adicionar(
        "assistente",
        confirmacaoEnvio(tipo, { numero: r.numero, telaNome: origem.telaNome, comPrint }),
        { ok: true },
      );
      setTexto("");
      setImg(null);
      setTarjas([]);
    } catch (e) {
      setErroForm(errorMessage(e, "Não foi possível registrar. Tente de novo."));
    } finally {
      setEnviando(false);
    }
  };

  const enviar = () => (modo === "uso" ? perguntarIA(texto) : enviarRegistro(modo));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void enviar();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (modo === "uso" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  const escolherArquivo = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setErroForm("O print deve ser PNG, JPG ou WEBP.");
      return;
    }
    if (file.size > PRINT_MAX_BYTES) {
      setErroForm("Imagem acima de 5 MB.");
      return;
    }
    try {
      setImg(await carregarImagem(file));
      setTarjas([]);
      setErroForm(null);
    } catch {
      setErroForm("Não foi possível abrir a imagem.");
    }
  };

  return (
    <div className="print:hidden" data-testid="ajuda-max-locacao">
      {aberto && (
        <section
          role="dialog"
          aria-label="Ajuda MAX"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 flex max-h-[min(600px,calc(100dvh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        >
          <header className="flex items-start gap-2 bg-primary px-4 py-3 text-primary-foreground">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Ajuda MAX</h2>
              <p className="text-xs opacity-90">
                Ensina a usar a Locação. Não consulta contratos nem clientes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="rounded p-1 hover:bg-white/15"
              aria-label="Fechar Ajuda MAX"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div
            className="flex gap-1 overflow-x-auto border-b px-2 py-2"
            role="tablist"
            aria-label="O que você quer fazer?"
          >
            {MODOS.map(({ modo: m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={modo === m}
                onClick={() => trocarModo(m)}
                className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${modo === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 text-sm">
            {itens.length === 0 && modo === "uso" && (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Pergunte como fazer algo na Locação e eu mostro onde clicar.
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={enviando || esgotado}
                      onClick={() => void perguntarIA(s)}
                      className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {itens.length === 0 && modo !== "uso" && (
              <p className="text-muted-foreground">
                {modo === "erro"
                  ? "Conte o que aconteceu. A tela de origem vai junto, e o print é opcional. A gestão vê em Sugestões e erros."
                  : "Conte sua ideia de melhoria. A gestão da imobiliária vê em Sugestões e erros."}
              </p>
            )}
            {itens.map((i) =>
              i.papel === "usuario" ? (
                <div
                  key={i.id}
                  className="ml-8 rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 break-words"
                >
                  {i.texto}
                </div>
              ) : (
                <div
                  key={i.id}
                  data-aviso={i.aviso ? "1" : undefined}
                  data-registro={i.ok ? "1" : undefined}
                  className={`mr-4 rounded-2xl rounded-bl-sm px-3 py-2 ${
                    i.ok
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100"
                      : i.aviso
                        ? "border border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                        : "bg-muted"
                  }`}
                >
                  <TextoResposta texto={i.texto} />
                </div>
              ),
            )}
            {enviando && (
              <p className="text-xs text-muted-foreground">
                {modo === "uso" ? "Ajuda MAX está respondendo…" : "Registrando…"}
              </p>
            )}
            <div ref={fim} />
          </div>

          <form onSubmit={onSubmit} className="space-y-1.5 border-t px-3 py-2">
            {travado ? (
              <p
                role="status"
                className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
              >
                {TEXTO_LIMITE(limite)}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Não escreva nome, CPF ou telefone de clientes.
              </p>
            )}
            {modo !== "uso" && (
              <div className="space-y-1.5">
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="ajuda-max-arquivo"
                  onChange={(e) => {
                    void escolherArquivo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {img ? (
                  <div className="space-y-1">
                    <div className="max-h-40 overflow-y-auto">
                      <EditorTarja img={img} tarjas={tarjas} setTarjas={setTarjas} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Arraste sobre a imagem para passar tarja em nomes, CPF, telefone e valores. O
                      print não vai para a IA.
                    </p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={!tarjas.length}
                        onClick={() => setTarjas(tarjas.slice(0, -1))}
                      >
                        <Eraser className="mr-1 h-3.5 w-3.5" /> Desfazer tarja
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setImg(null);
                          setTarjas([]);
                        }}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remover
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => inputRef.current?.click()}
                  >
                    <ImagePlus className="mr-1 h-3.5 w-3.5" /> Anexar print (opcional, até 5 MB)
                  </Button>
                )}
              </div>
            )}
            {erroForm && (
              <p role="alert" className="text-xs text-destructive">
                {erroForm}
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, maximo))}
                onKeyDown={onKey}
                placeholder={PLACEHOLDER[modo]}
                aria-label={
                  modo === "uso"
                    ? "Sua pergunta para o Ajuda MAX"
                    : modo === "erro"
                      ? "Descreva o erro"
                      : "Descreva sua ideia"
                }
                rows={2}
                disabled={travado}
                className="min-h-[2.75rem] min-w-0 flex-1 resize-none text-sm"
              />
              <Button
                type="submit"
                size="icon"
                aria-label={modo === "uso" ? "Enviar pergunta" : "Registrar envio"}
                disabled={enviando || travado || texto.trim().length < minimo}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <Link
                to="/locacoes/sugestoes"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => setAberto(false)}
              >
                Ver Sugestões e erros
              </Link>
              {modo === "uso" ? (
                <span data-testid="ajuda-max-uso">
                  {usadas} de {limite} perguntas hoje
                </span>
              ) : (
                <span>Ideias e erros não contam no limite</span>
              )}
            </div>
          </form>
        </section>
      )}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={aberto ? "Fechar Ajuda MAX" : "Abrir Ajuda MAX"}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {aberto ? <X className="h-6 w-6" /> : <MessageCircleQuestion className="h-6 w-6" />}
      </button>
    </div>
  );
}
