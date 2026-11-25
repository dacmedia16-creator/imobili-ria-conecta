import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { etapaVizinha, posicaoEtapa, textoEtapasVisiveis } from "@/lib/telas-lote2";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/leads";
import {
  diaMes,
  emAlerta,
  estadoProximo,
  FUNIL,
  nomeEtapa,
  type Etapa,
  type Funil,
} from "@/lib/crm";

const ESTADO_TXT = {
  sem: "Sem próximo passo",
  atrasado: "Atrasado",
  hoje: "Hoje",
  ok: "",
  fim: "",
} as const;

type CartaoProps = {
  lead: Lead;
  hoje: string;
  nomeDe: (id: string | null) => string;
  mostrarDono: boolean;
};

function classeCartao(lead: Lead, hoje: string) {
  return cn(
    "cursor-pointer touch-manipulation rounded-md border bg-background p-2 text-sm shadow-sm transition hover:border-primary/50",
    emAlerta(estadoProximo(lead, hoje)) && "border-red-500 bg-red-50 dark:bg-red-950/30",
  );
}

function Cartao({
  arrastavel,
  onOpen,
  ...p
}: CartaoProps & { arrastavel: boolean; onOpen: () => void }) {
  // O cartão em si fica parado (meio apagado) enquanto o "cartão flutuante" (DragOverlay) segue o
  // ponteiro: assim ele não é cortado pela rolagem da coluna e o quadro pode rolar sozinho.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: p.lead.id,
    disabled: !arrastavel,
  });
  // Teclado (item 11 t_532125eb): Enter abre o lead; Espaço pega/solta o cartão para mover com as
  // setas (o KeyboardSensor do quadro só começa arrasto com Espaço).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget && !isDragging) {
      e.preventDefault();
      onOpen();
      return;
    }
    listeners?.onKeyDown?.(e);
  };
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onKeyDown={onKeyDown}
      onClick={onOpen}
      aria-label={`Lead ${p.lead.nome}. Enter abre; Espaço pega para mover com as setas.`}
      data-testid="crm-cartao"
      className={cn(
        classeCartao(p.lead, p.hoje),
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isDragging && "opacity-40",
      )}
    >
      <ConteudoCartao {...p} />
    </div>
  );
}

function ConteudoCartao({ lead, hoje, nomeDe, mostrarDono }: CartaoProps) {
  const est = estadoProximo(lead, hoje);
  const alerta = emAlerta(est);
  const textoProximo = lead.proximo_contato_em
    ? `${ESTADO_TXT[est] ? `${ESTADO_TXT[est]} · ` : ""}${diaMes(lead.proximo_contato_em)} — ${lead.proximo_contato_motivo ?? ""}`
    : ESTADO_TXT.sem;
  return (
    <>
      <div className="break-words font-medium [overflow-wrap:anywhere]">{lead.nome}</div>
      {mostrarDono && (
        <div className="text-xs text-muted-foreground">
          {lead.no_banco_desde ? "No banco" : nomeDe(lead.responsavel_id)}
        </div>
      )}
      {!lead.aceito_em && lead.responsavel_id && est !== "fim" && (
        <div className="text-xs text-blue-700 dark:text-blue-300">Aguardando aceite</div>
      )}
      {est !== "fim" && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-xs",
            alerta ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground",
          )}
        >
          {alerta && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
          {/* Motivo longo: no máximo 2 linhas no cartão; o texto completo fica no title. */}
          <span
            className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]"
            title={textoProximo}
            data-testid="crm-card-proximo"
          >
            {textoProximo}
          </span>
        </div>
      )}
      {(lead.sale_id || lead.capture_convertida_id) && (
        <div className="text-xs text-green-700 dark:text-green-300">
          {lead.sale_id ? "Venda vinculada" : "Captação vinculada"}
        </div>
      )}
    </>
  );
}

function Coluna({
  funil,
  etapa,
  children,
  qtd,
}: {
  funil: Funil;
  etapa: Etapa;
  children: React.ReactNode;
  qtd: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  return (
    <div
      ref={setNodeRef}
      data-testid={`crm-coluna-${etapa}`}
      data-coluna-n={posicaoEtapa(funil, etapa).n}
      className={cn(
        "flex h-full min-h-0 w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 text-sm font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* Número da etapa (t_29b7cd5e): o corretor sabe onde está no funil mesmo com colunas fora da tela. */}
          <span
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1 text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border"
            aria-hidden
          >
            {posicaoEtapa(funil, etapa).n}
          </span>
          <span className="truncate">{nomeEtapa(funil, etapa)}</span>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{qtd}</span>
      </div>
      {/* Cada coluna rola os próprios cartões; o quadro não cresce além da tela. */}
      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {children}
      </div>
    </div>
  );
}

/**
 * Quadro de arrastar (dnd-kit). Desktop: colunas lado a lado. Celular: abas de etapa + "Mover para…"
 * no detalhe (o toque longo de 250 ms também arrasta). Soltar só PEDE a mudança: a tela abre o
 * diálogo certo (próximo contato, perda ou fechar) e o banco decide.
 */
export function CrmQuadro({
  funil,
  leads,
  hoje,
  nomeDe,
  mostrarDono,
  podeArrastar,
  onSoltar,
  onOpen,
}: {
  funil: Funil;
  leads: Lead[];
  hoje: string;
  nomeDe: (id: string | null) => string;
  mostrarDono: boolean;
  podeArrastar: (l: Lead) => boolean;
  onSoltar: (l: Lead, para: Etapa) => void;
  onOpen: (l: Lead) => void;
}) {
  const etapas = FUNIL[funil].etapas;
  const [abaCel, setAbaCel] = useState<Etapa>(etapas[0]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const porEtapa = (e: Etapa) => leads.filter((l) => l.etapa === e);
  const [arrastando, setArrastando] = useState<Lead | null>(null);

  // Quadro do computador: altura = do topo do quadro até o fim da tela, para a barra de rolagem
  // horizontal ficar sempre visível logo abaixo das colunas (antes ela ficava no fim da coluna
  // mais comprida, fora da tela).
  const quadroRef = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);
  const [lado, setLado] = useState({ esq: false, dir: false });
  // Etapas que aparecem inteiras na tela do computador (indicador "Etapas 1–4 de 6").
  const [visiveis, setVisiveis] = useState({ de: 1, ate: etapas.length });

  const medir = useCallback(() => {
    const el = quadroRef.current;
    if (!el || el.offsetParent === null) return; // escondido (celular ou outra aba)
    const topoNoDocumento = el.getBoundingClientRect().top + window.scrollY;
    setAltura(Math.max(360, Math.round(window.innerHeight - topoNoDocumento - 24)));
    const max = el.scrollWidth - el.clientWidth;
    setLado({ esq: el.scrollLeft > 2, dir: el.scrollLeft < max - 2 });
    const caixa = el.getBoundingClientRect();
    const inteiras = [...el.querySelectorAll<HTMLElement>("[data-coluna-n]")]
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= caixa.left - 2 && r.right <= caixa.right + 2;
      })
      .map((c) => Number(c.dataset.colunaN));
    if (inteiras.length) setVisiveis({ de: Math.min(...inteiras), ate: Math.max(...inteiras) });
  }, []);

  useEffect(() => {
    medir();
    const el = quadroRef.current;
    window.addEventListener("resize", medir);
    el?.addEventListener("scroll", medir, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(medir) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener("resize", medir);
      el?.removeEventListener("scroll", medir);
      ro?.disconnect();
    };
  }, [medir, leads.length]);

  const irParaColuna = (e: Etapa) => {
    const el = quadroRef.current;
    const col = el?.querySelector<HTMLElement>(`[data-testid="crm-coluna-${e}"]`);
    if (!el || !col) return;
    const x = col.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    el.scrollTo({ left: Math.max(0, x - 8), behavior: "smooth" });
  };

  const andar = (sentido: -1 | 1) => {
    const el = quadroRef.current;
    if (!el) return;
    el.scrollBy({ left: sentido * Math.max(268, el.clientWidth * 0.75), behavior: "smooth" });
  };

  const posCel = posicaoEtapa(funil, abaCel);
  const antCel = etapaVizinha(funil, abaCel, -1);
  const proxCel = etapaVizinha(funil, abaCel, 1);

  const inicio = (ev: DragStartEvent) =>
    setArrastando(leads.find((l) => l.id === ev.active.id) ?? null);

  const fim = (ev: DragEndEvent) => {
    setArrastando(null);
    const lead = leads.find((l) => l.id === ev.active.id);
    const para = ev.over?.id as Etapa | undefined;
    if (lead && para && para !== lead.etapa) onSoltar(lead, para);
  };

  const cartoes = (e: Etapa) =>
    porEtapa(e).map((l) => (
      <Cartao
        key={l.id}
        lead={l}
        hoje={hoje}
        nomeDe={nomeDe}
        mostrarDono={mostrarDono}
        arrastavel={podeArrastar(l)}
        onOpen={() => onOpen(l)}
      />
    ));

  return (
    <DndContext
      sensors={sensors}
      onDragStart={inicio}
      onDragEnd={fim}
      onDragCancel={() => setArrastando(null)}
      // Levar o cartão até a borda esquerda/direita do quadro rola as colunas sozinho.
      autoScroll={{ threshold: { x: 0.12, y: 0.15 }, acceleration: 12 }}
    >
      {/* Celular (t_29b7cd5e): uma coluna por vez. Seletor "Etapa 2 de 6" com setas e a lista de
          etapas; a faixa de pontos mostra onde o corretor está no funil. Mover de etapa continua no
          "Mover para…" do lead ou segurando o cartão. */}
      <div className="md:hidden" data-testid="crm-celular">
        <div className="mb-2 rounded-lg border bg-muted/40 p-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 shrink-0"
              disabled={!antCel}
              aria-label={antCel ? `Etapa anterior: ${nomeEtapa(funil, antCel)}` : "Primeira etapa"}
              onClick={() => antCel && setAbaCel(antCel)}
              data-testid="crm-etapa-anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <label className="min-w-0 flex-1">
              <span
                className="block px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                data-testid="crm-etapa-posicao"
              >
                Etapa {posCel.n} de {posCel.total}
              </span>
              <select
                value={abaCel}
                onChange={(ev) => setAbaCel(ev.target.value as Etapa)}
                aria-label="Escolher etapa"
                data-testid="crm-etapa-select"
                className="h-9 w-full truncate rounded-md border border-input bg-background px-2 text-base md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {etapas.map((e, i) => (
                  <option key={e} value={e}>
                    {i + 1}. {nomeEtapa(funil, e)} ({porEtapa(e).length})
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 shrink-0"
              disabled={!proxCel}
              aria-label={proxCel ? `Próxima etapa: ${nomeEtapa(funil, proxCel)}` : "Última etapa"}
              onClick={() => proxCel && setAbaCel(proxCel)}
              data-testid="crm-etapa-proxima"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="mt-2 flex gap-1" aria-hidden>
            {etapas.map((e) => (
              <span
                key={e}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  e === abaCel ? "bg-primary" : porEtapa(e).length ? "bg-primary/30" : "bg-border",
                )}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-2" data-testid="crm-coluna-celular">
          {porEtapa(abaCel).length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum lead em “{nomeEtapa(funil, abaCel)}”.
            </p>
          ) : (
            cartoes(abaCel)
          )}
        </div>
      </div>
      {/* Desktop: colunas (altura limitada à tela, rolagem lateral + setas) */}
      <div className="relative hidden md:block">
        {/* Etapas visíveis (t_29b7cd5e): régua com todas as etapas; clicar leva até a coluna. */}
        <div className="mb-2 flex items-center gap-3" data-testid="crm-regua">
          <span
            className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
            data-testid="crm-etapas-visiveis"
          >
            {textoEtapasVisiveis(visiveis.de, visiveis.ate, etapas.length)}
          </span>
          <ol
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            aria-label="Etapas do funil"
          >
            {etapas.map((e, i) => {
              const dentro = i + 1 >= visiveis.de && i + 1 <= visiveis.ate;
              return (
                <li key={e} className="flex shrink-0 items-center gap-1">
                  {i > 0 && <span className="h-px w-3 bg-border" aria-hidden />}
                  <button
                    type="button"
                    onClick={() => irParaColuna(e)}
                    aria-label={`Ir para a etapa ${i + 1}: ${nomeEtapa(funil, e)}`}
                    data-testid={`crm-regua-${e}`}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      dentro
                        ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <span className="tabular-nums">{i + 1}</span> {nomeEtapa(funil, e)}{" "}
                    <span className="tabular-nums text-muted-foreground">{porEtapa(e).length}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div
          ref={quadroRef}
          data-testid="crm-quadro"
          style={{ height: altura ?? undefined }}
          className="flex h-[calc(100dvh-16rem)] min-h-[360px] gap-3 overflow-x-auto overflow-y-hidden pb-3"
        >
          {etapas.map((e) => (
            <Coluna key={e} funil={funil} etapa={e} qtd={porEtapa(e).length}>
              {cartoes(e)}
            </Coluna>
          ))}
        </div>
        {lado.esq && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Ver colunas da esquerda"
            title="Ver etapas anteriores"
            data-testid="crm-seta-esq"
            onClick={() => andar(-1)}
            className="absolute left-1 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border shadow-md"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        {lado.dir && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Ver colunas da direita"
            title="Ver próximas etapas"
            data-testid="crm-seta-dir"
            onClick={() => andar(1)}
            className="absolute right-1 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border shadow-md"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {arrastando ? (
          <div className={cn(classeCartao(arrastando, hoje), "w-60 cursor-grabbing shadow-lg")}>
            <ConteudoCartao
              lead={arrastando}
              hoje={hoje}
              nomeDe={nomeDe}
              mostrarDono={mostrarDono}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
