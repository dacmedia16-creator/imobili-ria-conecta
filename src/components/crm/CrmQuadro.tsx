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
  return (
    <>
      <div className="break-words font-medium">{lead.nome}</div>
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
          {alerta && <AlertTriangle className="h-3 w-3" aria-hidden />}
          {lead.proximo_contato_em
            ? `${ESTADO_TXT[est] ? `${ESTADO_TXT[est]} · ` : ""}${diaMes(lead.proximo_contato_em)} — ${lead.proximo_contato_motivo ?? ""}`
            : ESTADO_TXT.sem}
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
      className={cn(
        "flex h-full min-h-0 w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="flex shrink-0 items-center justify-between px-1 text-sm font-medium">
        <span>{nomeEtapa(funil, etapa)}</span>
        <span className="text-xs text-muted-foreground">{qtd}</span>
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

  const medir = useCallback(() => {
    const el = quadroRef.current;
    if (!el || el.offsetParent === null) return; // escondido (celular ou outra aba)
    const topoNoDocumento = el.getBoundingClientRect().top + window.scrollY;
    setAltura(Math.max(360, Math.round(window.innerHeight - topoNoDocumento - 24)));
    const max = el.scrollWidth - el.clientWidth;
    setLado({ esq: el.scrollLeft > 2, dir: el.scrollLeft < max - 2 });
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

  const andar = (sentido: -1 | 1) => {
    const el = quadroRef.current;
    if (!el) return;
    el.scrollBy({ left: sentido * Math.max(268, el.clientWidth * 0.75), behavior: "smooth" });
  };

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
      {/* Celular: abas por etapa */}
      <div className="md:hidden">
        <div className="mb-2 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Etapas">
          {etapas.map((e) => (
            <Button
              key={e}
              size="sm"
              variant={abaCel === e ? "default" : "outline"}
              className="shrink-0"
              onClick={() => setAbaCel(e)}
            >
              {nomeEtapa(funil, e)} ({porEtapa(e).length})
            </Button>
          ))}
        </div>
        <div className="grid gap-2">
          {porEtapa(abaCel).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead nesta etapa.</p>
          ) : (
            cartoes(abaCel)
          )}
        </div>
      </div>
      {/* Desktop: colunas (altura limitada à tela, rolagem lateral + setas) */}
      <div className="relative hidden md:block">
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
