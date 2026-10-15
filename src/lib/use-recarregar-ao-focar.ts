import { useEffect, useRef } from "react";

/** Intervalo mínimo entre recargas automáticas (evita rajada ao alternar abas rapidamente). */
export const INTERVALO_MIN_RECARGA_MS = 15_000;

/** Decide se a volta à aba deve recarregar (aba visível e já passou o intervalo mínimo). */
export function deveRecarregar(visivel: boolean, agora: number, ultima: number): boolean {
  return visivel && agora - ultima >= INTERVALO_MIN_RECARGA_MS;
}

/**
 * Recarrega os dados quando a aba volta a ficar visível (página aberta há tempo mostra estado
 * antigo, ex.: captação já aprovada). Só leitura; não mexe em nada no banco.
 */
export function useRecarregarAoFocar(recarregar: () => unknown): void {
  const fn = useRef(recarregar);
  fn.current = recarregar;
  useEffect(() => {
    let ultima = Date.now();
    const aoMudar = () => {
      const agora = Date.now();
      if (!deveRecarregar(document.visibilityState === "visible", agora, ultima)) return;
      ultima = agora;
      void fn.current();
    };
    document.addEventListener("visibilitychange", aoMudar);
    window.addEventListener("focus", aoMudar);
    return () => {
      document.removeEventListener("visibilitychange", aoMudar);
      window.removeEventListener("focus", aoMudar);
    };
  }, []);
}
