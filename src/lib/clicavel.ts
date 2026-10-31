import type { KeyboardEvent } from "react";

/**
 * Props para um elemento que já abre algo no clique (linha, cartão) também funcionar pelo
 * teclado: entra no Tab, é anunciado como botão e abre com Enter ou Espaço (item 11 t_532125eb).
 * Teclas vindas de elementos internos (botões, links, campos) são ignoradas.
 */
export function clicavelPorTeclado(acao: () => void, rotulo?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    ...(rotulo ? { "aria-label": rotulo } : {}),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        acao();
      }
    },
  };
}
