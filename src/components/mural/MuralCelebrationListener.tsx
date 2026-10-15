import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { MuralCelebration } from "@/components/mural/MuralCelebration";
import { MUTE_EVENT, readMutedLocal, writeMutedLocal } from "@/lib/mural-celebration";
import {
  achievementsEnabled,
  achievementsMuted,
  currentOrgId,
  fireCelebrationConfetti,
  setAchievementsMuted,
  subscribeAchievements,
} from "@/lib/mural-module";

/**
 * Listener global do app autenticado (montado no AppShell). Relê módulo, imobiliária e
 * preferência sempre que muda o usuário (login/logout) ou o contexto de imobiliária.
 */
export function MuralCelebrationListener() {
  const { user, platformContext } = useAuth();
  const userId = user?.id ?? null;
  const contextOrgId = platformContext?.organizationId ?? null;
  const [enabled, setEnabled] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let alive = true;
    setEnabled(false);
    setOrganizationId(null);
    if (!userId) return;
    setMuted(readMutedLocal(userId));
    Promise.all([achievementsEnabled(), currentOrgId(), achievementsMuted(userId)]).then(
      ([on, org, mute]) => {
        if (!alive) return;
        setMuted(mute);
        writeMutedLocal(userId, mute);
        setOrganizationId(org);
        setEnabled(on && Boolean(org));
      },
    );
    return () => {
      alive = false;
    };
  }, [userId, contextOrgId]);

  // Mudança feita no Perfil (mesma aba) ou em outra aba do mesmo usuário.
  useEffect(() => {
    if (!userId) return;
    const sync = () => setMuted(readMutedLocal(userId));
    window.addEventListener(MUTE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MUTE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [userId]);

  const onMute = async () => {
    if (!userId) return;
    setMuted(true);
    writeMutedLocal(userId, true);
    try {
      await setAchievementsMuted(true);
      toast.success("Comemorações silenciadas. Você pode reativar em Meu acesso.");
    } catch {
      toast.error("Silenciado só neste navegador; não foi possível salvar no servidor.");
    }
  };

  return (
    <MuralCelebration
      userId={userId}
      organizationId={organizationId}
      enabled={enabled}
      muted={muted}
      subscribe={subscribeAchievements}
      fireConfetti={fireCelebrationConfetti}
      onMute={onMute}
    />
  );
}
