import type { ReactNode } from "react";

/**
 * Identidade visual da página MAX HUB (somosmaxhub.com.br / unicaescolha.com.br/empresa/)
 * aplicada às telas pré-login (t_610c48f7, pedido de Denis 20/10/2026).
 * Paleta, fontes (Sora/Inter) e marca hexagonal copiadas da fonte da página
 * (projetos/site-ecossistema-remax/app). Só visual: nenhuma lógica de autenticação aqui.
 */
export const MAXHUB = {
  navy950: "#071325",
  navy900: "#0b1b33",
  navy800: "#14305a",
  navy600: "#2a4f86",
  sky: "#8fb4e8",
  red: "#dc1c2e",
  redHover: "#c41626",
  gold: "#e3c682",
  mist: "#a9b8cf",
} as const;

/** Marca hexagonal azul-marinho com ponto vermelho — mesmo desenho do cabeçalho da página MAX HUB. */
export function MaxHubMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 2l12 7v14l-12 7-12-7V9z" fill="#14305a" stroke="#8fb4e8" strokeOpacity=".5" />
      <circle cx="16" cy="16" r="3.6" fill="#dc1c2e" />
    </svg>
  );
}

/**
 * Logo "UniHub" (marca + texto), como no topo da página do portal.
 * `nome` troca o texto exibido: a 1ª parte fica em branco e a 2ª em azul claro (#8fb4e8).
 * Padrão: "UniHub" (tela inicial e telas de login — t_fab8e9bf, t_65a34011).
 */
export function MaxHubLogo({
  className = "",
  nome = ["Uni", "Hub"],
}: {
  className?: string;
  nome?: [string, string];
}) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 font-maxhub-display text-[15px] font-extrabold tracking-tight text-white ${className}`}
    >
      <MaxHubMark />
      <span>
        {nome[0]}
        <span className={nome[0].endsWith(" ") ? "-ml-0.5 text-[#8fb4e8]" : "text-[#8fb4e8]"}>
          {nome[1]}
        </span>
      </span>
    </span>
  );
}

/** Rótulo com o traço vermelho (o "Eyebrow" da página MAX HUB). */
export function MaxHubEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a9b8cf]">
      <span className="h-px w-6 bg-[#dc1c2e]" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Classes do botão principal (pílula vermelha) da página MAX HUB. */
export const maxHubPrimaryButton =
  "group inline-flex items-center justify-center gap-2 rounded-full bg-[#dc1c2e] px-7 py-4 text-base font-semibold text-white transition-all duration-300 hover:bg-[#c41626] hover:shadow-[0_10px_40px_-8px_rgb(220_28_46/0.7)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#e3c682] disabled:pointer-events-none disabled:opacity-60";

/** Classes do botão secundário (contorno) da página MAX HUB. */
export const maxHubSecondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white/85 transition-colors hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#e3c682]";

/**
 * Fundo e moldura das telas pré-login: azul-marinho, grade técnica fina, luz suave e granulado,
 * cabeçalho com a marca MAX HUB. O conteúdo vai em `children`.
 */
export function MaxHubAuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="maxhub-auth relative isolate flex min-h-screen flex-col overflow-hidden bg-[#0b1b33] font-maxhub text-white antialiased">
      <div className="maxhub-grid-lines absolute inset-0 -z-10" aria-hidden="true" />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(640px circle at 72% 28%, rgb(42 79 134 / 0.45), transparent 60%)",
        }}
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-40 left-1/2 -z-10 h-80 w-[120%] -translate-x-1/2 rounded-[50%] bg-[#071325] blur-3xl"
        aria-hidden="true"
      />
      <div className="maxhub-grain pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

      <header className="mx-auto flex h-[calc(4rem+env(safe-area-inset-top))] w-full max-w-7xl items-center px-5 pt-[env(safe-area-inset-top)] lg:px-8">
        <MaxHubLogo />
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-5 pb-10 pt-4 lg:px-8">
        {children}
      </main>

      {footer && (
        <footer className="mx-auto w-full max-w-7xl px-5 pb-6 text-xs text-white/60 lg:px-8">
          {footer}
        </footer>
      )}
    </div>
  );
}
