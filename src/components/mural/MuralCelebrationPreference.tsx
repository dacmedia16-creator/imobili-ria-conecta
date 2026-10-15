import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MUTE_EVENT, readMutedLocal, writeMutedLocal } from "@/lib/mural-celebration";
import { achievementsEnabled, achievementsMuted, setAchievementsMuted } from "@/lib/mural-module";

/** Preferência "Comemorações de vendas" em Meu acesso. Só aparece com o módulo ligado. */
export function MuralCelebrationPreference({ userId }: { userId: string | undefined }) {
  const [visible, setVisible] = useState(false);
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    Promise.all([achievementsEnabled(), achievementsMuted(userId)]).then(([on, mute]) => {
      if (!alive) return;
      setVisible(on);
      setMuted(mute);
    });
    const sync = () => setMuted(readMutedLocal(userId));
    window.addEventListener(MUTE_EVENT, sync);
    return () => {
      alive = false;
      window.removeEventListener(MUTE_EVENT, sync);
    };
  }, [userId]);

  if (!visible || !userId) return null;

  const alternar = async (mostrar: boolean) => {
    setSaving(true);
    try {
      await setAchievementsMuted(!mostrar);
      setMuted(!mostrar);
      writeMutedLocal(userId, !mostrar);
    } catch {
      toast.error("Não foi possível salvar a preferência.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PartyPopper className="h-4 w-4" /> Comemorações de vendas
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          Mostrar confete e aviso quando alguém da imobiliária assinar uma venda
        </span>
        <Switch
          aria-label="Mostrar comemorações de vendas"
          checked={!muted}
          disabled={saving}
          onCheckedChange={(v) => void alternar(v)}
        />
      </CardContent>
    </Card>
  );
}
