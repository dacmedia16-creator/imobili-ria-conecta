/**
 * BorderBeam — adaptado de Magic UI (https://github.com/magicuidesign/magicui,
 * apps/www/registry/magicui/border-beam.tsx), licença MIT (ver LICENSE.md nesta pasta).
 *
 * Adaptações para o ADM MAX:
 * - sem a dependência `motion`: o feixe anda pela borda com CSS puro (`offset-path` +
 *   `@keyframes magicui-border-beam`, em src/styles.css);
 * - cores padrão nas cores RE/MAX (azul → vermelho);
 * - `prefers-reduced-motion: reduce` desliga o feixe (regra em src/styles.css);
 * - decorativo: `aria-hidden`, sem eventos de ponteiro.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  className?: string;
  borderWidth?: number;
  reverse?: boolean;
}

export function BorderBeam({
  className,
  size = 80,
  delay = 0,
  duration = 9,
  colorFrom = "var(--primary)",
  colorTo = "var(--secondary)",
  borderWidth = 1.5,
  reverse = false,
}: BorderBeamProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ "--border-beam-width": `${borderWidth}px` } as CSSProperties}
    >
      <div
        className={cn(
          "magicui-border-beam absolute aspect-square",
          "bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent",
          className,
        )}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            "--color-from": colorFrom,
            "--color-to": colorTo,
            animationDuration: `${duration}s`,
            animationDelay: `-${delay}s`,
            animationDirection: reverse ? "reverse" : "normal",
          } as CSSProperties
        }
      />
    </div>
  );
}
