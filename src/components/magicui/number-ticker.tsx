/**
 * NumberTicker — adaptado de Magic UI (https://github.com/magicuidesign/magicui,
 * apps/www/registry/magicui/number-ticker.tsx), licença MIT (ver LICENSE.md nesta pasta).
 *
 * Adaptações para o ADM MAX:
 * - sem a dependência `motion`: a contagem usa requestAnimationFrame com easing simples;
 * - números formatados em pt-BR (ou pelo `format` recebido, ex.: moeda BRL);
 * - respeita `prefers-reduced-motion`: mostra o valor final direto, sem animar;
 * - o texto inicial já é o valor final (acessibilidade/leitores de tela e sem "0" piscando
 *   quando a animação não roda).
 */
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

interface NumberTickerProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  value: number;
  /** Duração da contagem em ms. */
  duration?: number;
  decimalPlaces?: number;
  /** Formatação final; padrão = número pt-BR com `decimalPlaces` casas. */
  format?: (n: number) => string;
}

const prefereMenosMovimento = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function NumberTicker({
  value,
  duration = 900,
  decimalPlaces = 0,
  format,
  className,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatar =
    format ??
    ((n: number) =>
      n.toLocaleString("pt-BR", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }));
  const final = formatar(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!Number.isFinite(value) || value === 0 || prefereMenosMovimento()) {
      el.textContent = final;
      return;
    }
    let raf = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = t >= 1 ? final : formatar(Number((value * eased).toFixed(decimalPlaces)));
      if (t < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = final;
    };
    // `formatar` é recriada a cada render; `final` já reflete qualquer mudança relevante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, decimalPlaces, final]);

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {final}
    </span>
  );
}
