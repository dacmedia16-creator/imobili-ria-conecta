import { useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { AlertTriangle } from "lucide-react";
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

function Cartao({
  lead,
  hoje,
  nomeDe,
  mostrarDono,
  arrastavel,
  onOpen,
}: {
  lead: Lead;
  hoje: string;
  nomeDe: (id: string | null) => string;
  mostrarDono: boolean;
  arrastavel: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    disabled: !arrastavel,
  });
  const est = estadoProximo(lead, hoje);
  const alerta = emAlerta(est);
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={cn(
        "cursor-pointer touch-manipulation rounded-md border bg-background p-2 text-sm shadow-sm transition hover:border-primary/50",
        alerta && "border-red-500 bg-red-50 dark:bg-red-950/30",
        isDragging && "opacity-70 shadow-lg",
      )}
    >
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
    </div>
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
      className={cn(
        "flex min-h-[200px] w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between px-1 text-sm font-medium">
        <span>{nomeEtapa(funil, etapa)}</span>
        <span className="text-xs text-muted-foreground">{qtd}</span>
      </div>
      {children}
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

  const fim = (ev: DragEndEvent) => {
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
    <DndContext sensors={sensors} onDragEnd={fim}>
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
      {/* Desktop: colunas */}
      <div className="hidden gap-3 overflow-x-auto pb-2 md:flex">
        {etapas.map((e) => (
          <Coluna key={e} funil={funil} etapa={e} qtd={porEtapa(e).length}>
            {cartoes(e)}
          </Coluna>
        ))}
      </div>
    </DndContext>
  );
}
