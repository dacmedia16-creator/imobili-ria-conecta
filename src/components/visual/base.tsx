/**
 * Base visual comum (t_cbbf17c6, onda 1). Extraída das telas aprovadas por Denis:
 * Plataforma → Imobiliárias (PR #75) e Painel da Equipe (PR #76). Mesmas classes, para o
 * visual ser idêntico: cabeçalho com gradiente, KPI com ícone, etiqueta cor + texto, estado
 * vazio e skeleton. Só apresentação — nenhum cálculo, consulta ou regra mora aqui.
 */
import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type IconType = ComponentType<{ className?: string }>;

export type Tom = "blue" | "green" | "amber" | "red" | "violet" | "slate";

export const TOM_ICONE: Record<Tom, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
};
export const TOM_PILL: Record<Tom, string> = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  red: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};
export const TOM_PONTO: Record<Tom, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

/** Cabeçalho da página: faixa com gradiente, ícone, título, explicação curta e ações. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon: IconType;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm sm:p-6",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="shrink-0 rounded-xl bg-primary p-2.5 text-primary-foreground shadow-sm"
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </h1>
            {description && (
              <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</div>
            )}
          </div>
        </div>
        {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}

/** Etiqueta de status: sempre cor + texto (regra de Denis). */
export function Pill({
  tom,
  children,
  className,
}: {
  tom: Tom;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TOM_PILL[tom],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TOM_PONTO[tom])} aria-hidden />
      {children}
    </span>
  );
}

/** Estado vazio: ícone apagado + explicação do que fazer. */
export function EmptyState({
  icon: Icon = Inbox,
  children,
  action,
  className,
}: {
  icon?: IconType;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-6 w-6 opacity-60" aria-hidden />
      <div className="max-w-md">{children}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * Estado de erro de carga (item 1 t_8730be75): deixa claro que NÃO é lista vazia nem zero, e
 * oferece "Tentar de novo". Mesmo visual do erro do Mural, que já funcionava bem.
 */
export function ErrorState({
  children = "Não foi possível carregar os dados.",
  onRetry,
  retrying = false,
  className,
}: {
  children?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>{children}</div>
      </div>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 text-foreground"
          onClick={onRetry}
          disabled={retrying}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {retrying ? "Carregando…" : "Tentar de novo"}
        </Button>
      )}
    </div>
  );
}

/**
 * KPI com ícone colorido (mesmo visual do Painel da Equipe, onda 2). Só exibe o valor já
 * calculado pela tela — não calcula nada.
 */
export function KpiTile({
  label,
  value,
  icon: Icon,
  tom = "blue",
  valueClassName,
  info,
  destaque,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  icon: IconType;
  tom?: Tom;
  valueClassName?: string;
  /** Elemento opcional de ajuda (ex.: InfoDot), mostrado ao lado do ícone. */
  info?: ReactNode;
  destaque?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md sm:p-4",
        destaque && "border-primary/40 ring-1 ring-primary/20",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium leading-tight text-muted-foreground">{label}</p>
        <div className="flex shrink-0 items-center gap-1">
          {/* InfoDot é absoluto (canto do pai): esta caixa de 28px o alinha ao lado do ícone. */}
          {info && <span className="relative block h-7 w-7">{info}</span>}
          <span className={cn("rounded-lg p-1.5", TOM_ICONE[tom])} aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
        </div>
      </div>
      <p
        className={cn(
          "mt-1 break-words text-lg font-semibold tabular-nums tracking-tight sm:text-2xl",
          valueClassName,
        )}
      >
        {value}
      </p>
      {children && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Linha "rótulo: valor" usada nos cartões que substituem tabelas no celular. */
export function CardField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Skeleton de grade de KPIs (mesmo formato do Painel da Equipe). */
export function KpiGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}
      aria-busy="true"
      aria-label="Carregando indicadores"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border bg-card p-4">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton de lista/tabela: linhas no desktop, cartões no celular. */
export function ListSkeleton({
  rows = 6,
  label = "Carregando",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}
