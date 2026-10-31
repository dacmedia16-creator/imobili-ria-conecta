import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Label } from "@/components/ui/label";

/**
 * Item 23 (FASE 2): as duas telas de entrada (perfil e foto → dados e ficha) passam a ter o
 * mesmo título, a mesma moldura e a mesma marcação de etapas. Só a aparência foi unificada:
 * quem decide se cada tela aparece continua sendo o seu porteiro (CompletarPerfilGate e
 * FichaColaboradorGate), com as mesmas regras de cadastro obrigatório de antes.
 */
export const TITULO_PORTEIRO = "Complete seu cadastro";

export const ETAPAS_PORTEIRO = ["Perfil e foto", "Dados e ficha"] as const;

export function PorteiroEntrada({
  testId,
  etapa,
  mostrarEtapas,
  descricao,
  largura = "md",
  children,
}: {
  testId: string;
  /** 1 = perfil e foto; 2 = dados e ficha. */
  etapa: 1 | 2;
  /** Só faz sentido mostrar "1 → 2" para quem pode passar pelas duas telas (corretor). */
  mostrarEtapas: boolean;
  descricao: ReactNode;
  largura?: "md" | "lg";
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6 sm:py-10" data-testid={testId}>
      <div
        className={`mx-auto w-full ${largura === "lg" ? "max-w-lg" : "max-w-md"} space-y-5 rounded-2xl border bg-background p-5 shadow-sm sm:p-7`}
      >
        <div className="space-y-1 text-center">
          <img src="/remax-icon.png" alt="" className="mx-auto h-10 w-10 object-contain" />
          <h1 className="text-xl font-semibold tracking-tight">{TITULO_PORTEIRO}</h1>
          {mostrarEtapas && (
            <ol
              className="flex items-center justify-center gap-2 pt-1 text-xs"
              aria-label="Etapas do cadastro"
              data-testid="porteiro-etapas"
            >
              {ETAPAS_PORTEIRO.map((nome, i) => {
                const n = i + 1;
                const atual = n === etapa;
                const feita = n < etapa;
                return (
                  <li
                    key={nome}
                    className="flex items-center gap-1.5"
                    aria-current={atual ? "step" : undefined}
                  >
                    {i > 0 && <span className="h-px w-4 bg-border" aria-hidden />}
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-semibold ${
                        atual
                          ? "border-primary bg-primary text-primary-foreground"
                          : feita
                            ? "border-primary text-primary"
                            : "text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {feita ? <Check className="h-3 w-3" /> : n}
                    </span>
                    <span className={atual ? "font-medium" : "text-muted-foreground"}>{nome}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-sm text-muted-foreground">{descricao}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Campo com rótulo ligado ao input, usado nas duas telas de entrada. */
export function CampoPorteiro({
  id,
  label,
  erro,
  sufixoErro = " — obrigatório",
  dica,
  children,
}: {
  id: string;
  label: string;
  erro?: boolean;
  /** Texto colado ao rótulo quando há erro. CRECI passa "" (opcional sempre, t_6b800cea). */
  sufixoErro?: string;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={erro ? "text-destructive" : undefined}>
        {label}
        {erro ? sufixoErro : ""}
      </Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

/** Espera comum das duas telas de entrada (antes era só o texto "Carregando…"). */
export function PorteiroCarregando() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <img src="/remax-icon.png" alt="" className="h-10 w-10 animate-pulse object-contain" />
      Carregando…
    </div>
  );
}
