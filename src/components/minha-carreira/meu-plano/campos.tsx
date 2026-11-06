import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fmt,
  ok,
  type Calc,
  type Fmt,
  type Respostas,
  type Valor,
} from "@/lib/meu-plano-2027/regras";

/** Contexto de uma tela do plano: respostas, contas e se é somente leitura (visão do broker). */
export type CtxPlano = {
  S: Respostas;
  C: Calc;
  set: (k: string, v: Valor) => void;
  ro: boolean;
  /** Dia de início da trilha Ativação (YYYY-MM-DD) — os 90 dias contam daqui. */
  inicio: string | null;
  trilha: "ativacao" | "planejamento";
};
export const PlanoCtx = createContext<CtxPlano | null>(null);
export const usePlanoCtx = () => {
  const c = useContext(PlanoCtx);
  if (!c) throw new Error("usePlanoCtx fora do PlanoCtx");
  return c;
};

export type TipoCampo = "money" | "pct" | "int" | "text" | "area" | "date" | "time";
const PH: Partial<Record<TipoCampo, string>> = {
  money: "R$ 0",
  pct: "%",
  int: "0",
  text: "Escreva aqui",
  area: "Escreva aqui",
};

export function Inp({
  k,
  tipo = "text",
  ph,
  className,
  label,
  id,
}: {
  k: string;
  tipo?: TipoCampo;
  ph?: string;
  className?: string;
  /** Rótulo acessível quando não há <label> visível. */
  label?: string;
  id?: string;
}) {
  const { S, set, ro } = usePlanoCtx();
  const v = S[k];
  const valor = v === undefined || v === null || typeof v === "boolean" ? "" : String(v);
  const comum = {
    id,
    "data-k": k,
    value: valor,
    disabled: ro,
    placeholder: ph ?? PH[tipo] ?? "",
    "aria-label": label,
  };
  if (tipo === "area")
    return (
      <Textarea
        {...comum}
        className={cn("min-h-[64px] text-base", className)}
        maxLength={4000}
        onChange={(e) => set(k, e.target.value)}
      />
    );
  return (
    <Input
      {...comum}
      type={tipo === "date" || tipo === "time" ? tipo : "text"}
      inputMode={tipo === "money" || tipo === "pct" || tipo === "int" ? "decimal" : undefined}
      maxLength={tipo === "text" ? 300 : 40}
      className={cn(
        "h-10 text-base",
        (tipo === "money" || tipo === "pct" || tipo === "int") && "text-right",
        className,
      )}
      onChange={(e) => set(k, e.target.value)}
    />
  );
}

export function Campo({
  k,
  label,
  tipo = "text",
  ph,
  hint,
}: {
  k: string;
  label: ReactNode;
  tipo?: TipoCampo;
  ph?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1 pt-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <Inp k={k} tipo={tipo} ph={ph} id={id} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Selecao({
  k,
  label,
  opcoes,
  ph = "Escolha…",
}: {
  k: string;
  label: ReactNode;
  opcoes: [string, string][];
  ph?: string;
}) {
  const { S, set, ro } = usePlanoCtx();
  const id = useId();
  return (
    <div className="space-y-1 pt-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <select
        id={id}
        data-k={k}
        disabled={ro}
        value={typeof S[k] === "string" ? (S[k] as string) : ""}
        onChange={(e) => set(k, e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-base disabled:opacity-70"
      >
        <option value="">{ph}</option>
        {opcoes.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Linha "rótulo à esquerda, campo à direita" (orçamentos, metas). */
export function Linha({
  k,
  rot,
  sub,
  tipo = "money",
  ph,
}: {
  k: string;
  rot: ReactNode;
  sub?: ReactNode;
  tipo?: TipoCampo;
  ph?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_7.5rem] items-center gap-2 border-b border-dashed py-2 last:border-0">
      <div className="min-w-0 text-sm">
        {rot}
        {sub ? <small className="block text-xs text-muted-foreground">{sub}</small> : null}
      </div>
      <Inp k={k} tipo={tipo} ph={ph} label={typeof rot === "string" ? rot : undefined} />
    </div>
  );
}

/** Conta automática (somente leitura). */
export function Conta({
  rot,
  v,
  f = "brl",
  main,
}: {
  rot: ReactNode;
  v: number | string;
  f?: Fmt | "txt";
  main?: boolean;
}) {
  const txt = f === "txt" ? (v ? String(v) : "—") : fmt[f](v as number);
  return (
    <div
      className={cn(
        "mt-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2",
        main ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
      )}
      data-conta
    >
      <span className="text-[13px] leading-tight">{rot}</span>
      <b className={cn("text-right tabular-nums", main ? "text-lg" : "text-base")}>{txt}</b>
    </div>
  );
}

export function Check({ k, children }: { k: string; children: ReactNode }) {
  const { S, set, ro } = usePlanoCtx();
  return (
    <label className="flex items-start gap-3 border-b border-dashed py-2.5 text-sm last:border-0">
      <input
        type="checkbox"
        data-k={k}
        className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
        checked={S[k] === true}
        disabled={ro}
        onChange={(e) => set(k, e.target.checked ? true : null)}
      />
      <span className="flex-1">{children}</span>
    </label>
  );
}

export function Radio({ k, opcoes }: { k: string; opcoes: string[] }) {
  const { S, set, ro } = usePlanoCtx();
  return (
    <div role="radiogroup">
      {opcoes.map((o) => (
        <label
          key={o}
          className="flex items-start gap-3 border-b border-dashed py-2.5 text-sm last:border-0"
        >
          <input
            type="radio"
            name={k}
            data-k={k}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
            checked={S[k] === o}
            disabled={ro}
            onChange={() => set(k, o)}
          />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

/** Nota de 1 a 5 em botões grandes (toque no celular). */
export function Nota({ k, rot }: { k: string; rot: ReactNode }) {
  const { S, set, ro } = usePlanoCtx();
  return (
    <div className="pt-3">
      <p className="mb-1 text-sm font-semibold">{rot}</p>
      <div className="flex gap-1" role="group">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={ro}
            data-nota={`${k}=${n}`}
            aria-pressed={String(S[k]) === String(n)}
            onClick={() => set(k, String(n))}
            className={cn(
              "h-10 flex-1 rounded-md border text-sm font-semibold",
              String(S[k]) === String(n)
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Bloco({
  titulo,
  children,
  className,
}: {
  titulo?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-3.5", className)}>
      {titulo ? <h3 className="mb-1 text-base font-semibold">{titulo}</h3> : null}
      {children}
    </section>
  );
}

export const Aviso = ({
  children,
  tom = "amber",
}: {
  children: ReactNode;
  tom?: "amber" | "green";
}) => (
  <div
    className={cn(
      "mt-2 rounded-lg px-3 py-2 text-[13px]",
      tom === "amber"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    )}
  >
    {children}
  </div>
);

export const Citacao = ({ children }: { children: ReactNode }) => (
  <div className="my-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-sm dark:bg-red-950/30">
    {children}
  </div>
);

export const Stat = ({ v, rot }: { v: ReactNode; rot: ReactNode }) => (
  <div className="rounded-lg bg-primary/10 p-2.5 text-center">
    <b className="block text-lg text-primary">{v}</b>
    <small className="text-xs text-muted-foreground">{rot}</small>
  </div>
);

export const okNum = ok;
