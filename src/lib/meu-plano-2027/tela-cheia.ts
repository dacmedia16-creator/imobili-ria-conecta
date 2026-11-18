/**
 * Tela cheia do leitor do book (Fullscreen API), com o prefixo webkit do Safari antigo.
 * O iPhone não deixa pôr um elemento comum em tela cheia (só vídeo): lá `suportaTelaCheia` dá false
 * e o botão fica escondido.
 */

type DocTelaCheia = {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type ElTelaCheia = {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** O navegador deixa pôr um elemento comum em tela cheia? */
export function suportaTelaCheia(doc: DocTelaCheia | undefined, el?: ElTelaCheia | null): boolean {
  if (!doc) return false;
  if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) return false;
  if (el && !(el.requestFullscreen || el.webkitRequestFullscreen)) return false;
  return true;
}

/** Elemento que está em tela cheia agora (ou null). */
export function elementoTelaCheia(doc: DocTelaCheia): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Entra na tela cheia com `el`; erro (ex.: recusado pelo navegador) vira false, sem quebrar a tela. */
export async function entrarTelaCheia(el: ElTelaCheia): Promise<boolean> {
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

/** Sai da tela cheia, se estiver nela. */
export async function sairTelaCheia(doc: DocTelaCheia): Promise<void> {
  if (!elementoTelaCheia(doc)) return;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
  } catch {
    // já saiu (Esc) ou o navegador recusou: nada a fazer.
  }
}
