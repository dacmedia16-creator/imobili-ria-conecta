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
import { AJUDA, type IdAjuda } from "@/lib/meu-plano-2027/ajuda";
import { InfoDot } from "@/components/dashboard/shared";

/** Contexto de uma tela do plano: respostas, contas e se é somente leitura (visão do broker). */
export type CtxPlano = {
  S: Respostas;
  C: Calc;
  set: (k: string, v: Valor) => void;
  ro: boolean;
  /** Dia 1 dos 90 dias (YYYY-MM-DD), de inicioNoventaDias(): ativacao_inicio gravado ou d90.inicio. */
  inicio: string | null;
};
export const PlanoCtx = createContext<CtxPlano | null>(null);
export const usePlanoCtx = () => {
  const c = useContext(PlanoCtx);
  if (!c) throw new Error("usePlanoCtx fora do PlanoCtx");
  return c;
};

/**
 * Bolinha "i" com o "como preencher" da parte (textos em lib/meu-plano-2027/ajuda.ts). Usa o InfoDot do
 * ADM MAX: abre no toque, no clique, no hover e no foco do teclado (Esc fecha). `canto` = no canto do
 * bloco sem título; sem `canto`, fica ao lado do título e a explicação abre embaixo, alinhada ao 1º pai
 * com `relative` (a linha do título).
 */
export function Dica({ id, canto }: { id: IdAjuda; canto?: boolean }) {
  const a = AJUDA[id];
  return <InfoDot inline={!canto} text={a.t} label={`Como preencher: ${a.nome}`} />;
}

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

/** Rótulo do campo; com `ajuda`, a bolinha fica fora do <label> (tocar nela não foca o campo). */
function Rotulo({
  htmlFor,
  ajuda,
  children,
}: {
  htmlFor: string;
  ajuda?: IdAjuda;
  children: ReactNode;
}) {
  const label = (
    <label htmlFor={htmlFor} className="block text-sm font-semibold">
      {children}
    </label>
  );
  if (!ajuda) return label;
  return (
    <div className="relative flex items-center gap-1.5">
      {label}
      <Dica id={ajuda} />
    </div>
  );
}

export function Campo({
  k,
  label,
  tipo = "text",
  ph,
  hint,
  ajuda,
}: {
  k: string;
  label: ReactNode;
  tipo?: TipoCampo;
  ph?: string;
  hint?: ReactNode;
  ajuda?: IdAjuda;
}) {
  const id = useId();
  return (
    <div className="space-y-1 pt-2">
      <Rotulo htmlFor={id} ajuda={ajuda}>
        {label}
      </Rotulo>
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
  ajuda,
}: {
  k: string;
  label: ReactNode;
  opcoes: [string, string][];
  ph?: string;
  ajuda?: IdAjuda;
}) {
  const { S, set, ro } = usePlanoCtx();
  const id = useId();
  return (
    <div className="space-y-1 pt-2">
      <Rotulo htmlFor={id} ajuda={ajuda}>
        {label}
      </Rotulo>
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
  ajuda,
}: {
  titulo?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Bolinha "como preencher": ao lado do título ou, sem título, no canto do bloco. */
  ajuda?: IdAjuda;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-3.5",
        ajuda && !titulo && "relative pt-7",
        className,
      )}
    >
      {titulo && ajuda ? (
        // A bolinha fica fora do <h3> para o texto escondido da dica não entrar no nome do título.
        <div className="relative mb-1 flex items-center gap-1.5">
          <h3 className="text-base font-semibold">{titulo}</h3>
          <Dica id={ajuda} />
        </div>
      ) : titulo ? (
        <h3 className="mb-1 text-base font-semibold">{titulo}</h3>
      ) : ajuda ? (
        <Dica id={ajuda} canto />
      ) : null}
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
