/**
 * Ajuda MAX na Locação — fatia 1/2 (t_b037935e; maquete t_8e76e1c3 aprovada por Denis em 11/11/2026).
 * Balão fixo no canto inferior direito, só nas telas /locacoes e só com a chave "ajuda_max_locacao" + Locação
 * ligadas na imobiliária. Ensina a usar a tela; não lê nem envia dados de locações, clientes ou contratos.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageCircleQuestion, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
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
import { perguntarAjudaMaxLocacao } from "@/lib/ajuda-max-locacao.functions";

const db = supabase as unknown as SupabaseClient;

type Item = Mensagem & { id: number; aviso?: boolean };

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
  const [ligado, setLigado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [usadas, setUsadas] = useState(0);
  const [limite, setLimite] = useState(LIMITE_DIA);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [itens, setItens] = useState<Item[]>([]);
  const seq = useRef(0);
  const fim = useRef<HTMLDivElement>(null);

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

  const adicionar = (papel: Item["papel"], t: string, aviso = false) =>
    setItens((xs) => [...xs, { id: ++seq.current, papel, texto: t, aviso }]);

  const enviar = async (pergunta: string) => {
    const p = pergunta.trim();
    if (enviando || p.length < PERGUNTA_MIN || esgotado) return;
    // Só as trocas normais vão como histórico (avisos do sistema não).
    const historico = itens
      .filter((i) => !i.aviso)
      .map(({ papel, texto: t }) => ({ papel, texto: t }));
    adicionar("usuario", p);
    setTexto("");
    setEnviando(true);
    try {
      const r = await perguntar({ data: { pergunta: p, tela, historico: historico.slice(-4) } });
      setUsadas(r.usadas);
      setLimite(r.limite);
      if (r.ok) adicionar("assistente", r.resposta, !r.sabe);
      else adicionar("assistente", r.mensagem, true);
    } catch {
      adicionar("assistente", TEXTO_INDISPONIVEL, true);
    } finally {
      setEnviando(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void enviar(texto);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar(texto);
    }
  };

  return (
    <div className="print:hidden" data-testid="ajuda-max-locacao">
      {aberto && (
        <section
          role="dialog"
          aria-label="Ajuda MAX"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 flex max-h-[min(560px,calc(100dvh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
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

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 text-sm">
            {itens.length === 0 && (
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
                      onClick={() => void enviar(s)}
                      className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
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
                  className={`mr-4 rounded-2xl rounded-bl-sm px-3 py-2 ${i.aviso ? "border border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "bg-muted"}`}
                >
                  <TextoResposta texto={i.texto} />
                </div>
              ),
            )}
            {enviando && (
              <p className="text-xs text-muted-foreground">Ajuda MAX está respondendo…</p>
            )}
            <div ref={fim} />
          </div>

          <form onSubmit={onSubmit} className="space-y-1.5 border-t px-3 py-2">
            {esgotado ? (
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
            <div className="flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, PERGUNTA_MAX))}
                onKeyDown={onKey}
                placeholder="Pergunte como usar…"
                aria-label="Sua pergunta para o Ajuda MAX"
                rows={2}
                disabled={esgotado}
                className="min-h-[2.75rem] min-w-0 flex-1 resize-none text-sm"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Enviar pergunta"
                disabled={enviando || esgotado || texto.trim().length < PERGUNTA_MIN}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-right text-[11px] text-muted-foreground" data-testid="ajuda-max-uso">
              {usadas} de {limite} perguntas hoje
            </p>
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
