import { useCallback, useEffect, useRef, useState } from "react";
import { BellOff, PartyPopper, X } from "lucide-react";
import {
  CELEBRATION_DURATION_MS,
  celebrationPeopleText,
  markSeen,
  prefersReducedMotion,
  readSeen,
  shouldCelebrate,
  type CelebrationPost,
} from "@/lib/mural-celebration";

export type RealtimeEvent = { eventType?: string; new?: unknown };
/** Assina o canal da imobiliária e devolve a função que cancela a assinatura. */
export type SubscribeFn = (
  organizationId: string,
  onEvent: (e: RealtimeEvent) => void,
) => () => void;
export type FireConfettiFn = () => void;

type Props = {
  userId: string | null;
  organizationId: string | null;
  enabled: boolean;
  muted: boolean;
  subscribe: SubscribeFn;
  fireConfetti: FireConfettiFn;
  onMute: () => void;
  durationMs?: number;
};

/**
 * Aviso de venda assinada: confete + faixa no canto, sem modal e sem tocar no foco.
 * - Só assina o canal com módulo ligado, usuário logado e imobiliária conhecida; troca de
 *   imobiliária ou logout cancela a assinatura (cleanup do efeito).
 * - Some sozinho em ~4 s; tem botão de fechar e de silenciar.
 * - Cada conquista aparece uma vez por pessoa (IDs vistos no localStorage do usuário).
 */
export function MuralCelebration({
  userId,
  organizationId,
  enabled,
  muted,
  subscribe,
  fireConfetti,
  onMute,
  durationMs = CELEBRATION_DURATION_MS,
}: Props) {
  const [current, setCurrent] = useState<CelebrationPost | null>(null);
  // Refs para o callback do canal enxergar o estado atual sem reassinar a cada mudança.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const fireRef = useRef(fireConfetti);
  fireRef.current = fireConfetti;

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      if (!userId) return;
      const post = shouldCelebrate(event, {
        enabled,
        muted: mutedRef.current,
        organizationId,
        seen: readSeen(userId),
      });
      if (!post) return;
      markSeen(userId, post.id);
      setCurrent(post);
      if (!prefersReducedMotion()) fireRef.current();
    },
    [userId, organizationId, enabled],
  );

  useEffect(() => {
    if (!enabled || !userId || !organizationId) return;
    const unsubscribe = subscribe(organizationId, handleEvent);
    return () => unsubscribe();
  }, [enabled, userId, organizationId, subscribe, handleEvent]);

  // Logout, troca de imobiliária ou módulo desligado: some com o aviso aberto.
  useEffect(() => {
    setCurrent(null);
  }, [userId, organizationId, enabled]);

  useEffect(() => {
    if (muted) setCurrent(null);
  }, [muted]);

  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => setCurrent(null), durationMs);
    return () => window.clearTimeout(t);
  }, [current, durationMs]);

  if (!current) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mural-celebration"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3 print:hidden"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-white/95 p-3 shadow-lg backdrop-blur motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 dark:bg-zinc-900/95">
        <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Venda assinada! Parabéns, equipe!</p>
          <p className="text-muted-foreground">{celebrationPeopleText(current)}</p>
          {current.imovel && <p className="text-xs text-muted-foreground">{current.imovel}</p>}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setCurrent(null);
              onMute();
            }}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            <BellOff className="h-3 w-3" aria-hidden /> Silenciar comemorações
          </button>
        </div>
        <button
          type="button"
          aria-label="Fechar aviso"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setCurrent(null)}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
