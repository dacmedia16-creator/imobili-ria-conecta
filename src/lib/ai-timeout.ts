/** Tempo-limite de cada chamada à IA (Gemini). Ao estourar, a tela libera e o usuário preenche manualmente. */
export const AI_TIMEOUT_MS = 25_000;

export const AI_TIMEOUT_MESSAGE = "A leitura demorou. Preencha manualmente.";

/** `AbortSignal.timeout` rejeita com TimeoutError; um abort manual vem como AbortError. */
export function isAiTimeoutError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}
