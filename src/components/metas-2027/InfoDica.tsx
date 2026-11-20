import { useContext, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explicacao, type ChaveExplicacao } from "@/lib/metas-2027/explicacoes";
import { ContextoInfo } from "./contexto-info";

/**
 * Ícone "i" dos painéis de metas 2027 (cartão t_065a0ff9). Explica o que o número é e de onde vem; os textos
 * ficam todos em src/lib/metas-2027/explicacoes.ts.
 * - Celular: abre com toque, fecha ao tocar fora (ou no próprio "i").
 * - Computador: abre ao passar o mouse ou com clique (o clique "fixa" aberto); fecha ao sair com o mouse, ao
 *   clicar fora ou com Esc.
 * - Fica AO LADO do rótulo, nunca em cima do número; o balão vai para o lado que couber na tela (Radix).
 */
export function InfoDica({
  chave,
  className = "",
}: {
  chave: ChaveExplicacao;
  className?: string;
}) {
  const ctx = useContext(ContextoInfo);
  const { titulo, texto } = explicacao(chave, ctx);
  const [open, setOpen] = useState(false);
  const porMouse = useRef(false);
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelar = () => {
    if (fechar.current) clearTimeout(fechar.current);
    fechar.current = null;
  };
  useEffect(() => cancelar, []);
  const entrar = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelar();
    if (!open) {
      porMouse.current = true;
      setOpen(true);
    }
  };
  const sair = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !porMouse.current) return;
    cancelar();
    fechar.current = setTimeout(() => setOpen(false), 150);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (!v) porMouse.current = false;
        setOpen(v);
      }}
    >
      <PopoverTrigger
        type="button"
        aria-label={`O que é: ${titulo}`}
        data-testid={`info-${chave}`}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        onPointerEnter={entrar}
        onPointerLeave={sair}
        onClick={(e) => {
          // Aberto pelo mouse: o clique fixa (não fecha). Senão, abre/fecha normalmente.
          e.preventDefault();
          cancelar();
          if (open && porMouse.current) porMouse.current = false;
          else {
            porMouse.current = false;
            setOpen(!open);
          }
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        collisionPadding={8}
        className="w-64 max-w-[calc(100vw-16px)] p-3 text-xs leading-snug"
        data-testid="info-balao"
        onPointerEnter={entrar}
        onPointerLeave={sair}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="mb-1 font-semibold">{titulo}</p>
        <p className="text-muted-foreground">{texto}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Rótulo + "i" na mesma linha (o "i" nunca fica em cima do número). */
export function RotuloInfo({
  chave,
  children,
  className = "",
}: {
  chave: ChaveExplicacao;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span>{children}</span>
      <InfoDica chave={chave} />
    </span>
  );
}
