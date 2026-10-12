/**
 * BentoGrid / BentoCard — adaptado de Magic UI (https://github.com/magicuidesign/magicui,
 * apps/www/registry/magicui/bento-grid.tsx), licença MIT (ver LICENSE.md nesta pasta).
 *
 * Adaptações para o ADM MAX:
 * - o cartão inteiro é um <Link> do TanStack Router (rota interna, acessível por teclado),
 *   em vez de um botão "cta" que só aparece no hover — no celular não existe hover;
 * - altura compacta e grade responsiva (1 coluna no celular, até 3 no desktop);
 * - fundo em tom suave por cartão (`tone`), seguindo a maquete aprovada (t_3a48630f);
 * - transições desligadas com `motion-reduce:`.
 */
import type { ElementType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Colunas no desktop conforme a quantidade de cartões visíveis (1 a 3), para não sobrar coluna
 * vazia quando o perfil não tem acesso a todos os atalhos. Classes estáticas (Tailwind). */
const COLUNAS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
};

export function BentoGrid({
  children,
  className,
  count = 3,
}: {
  children: ReactNode;
  className?: string;
  count?: number;
}) {
  return (
    <div
      className={cn(
        "grid w-full auto-rows-[9.5rem] gap-4",
        COLUNAS[count] ?? COLUNAS[3],
        className,
      )}
    >
      {children}
    </div>
  );
}

type Tone = "blue" | "red";

export function BentoCard({
  name,
  description,
  Icon,
  to,
  tone = "blue",
  className,
}: {
  name: string;
  description: string;
  Icon: ElementType;
  to: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 outline-none",
        "[box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]",
        "transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        tone === "red" ? "bg-secondary/[0.06]" : "bg-primary/[0.05]",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className="h-10 w-10 origin-left text-foreground/70 transition-transform duration-300 group-hover:scale-90 motion-reduce:transition-none"
      />
      <div>
        <h3 className="text-lg font-semibold text-foreground">{name}</h3>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {description}
          <ArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </p>
      </div>
    </Link>
  );
}
