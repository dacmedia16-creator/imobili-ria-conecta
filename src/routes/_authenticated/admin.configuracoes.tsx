import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { guardExclusiveSettingsRoute } from "@/lib/exclusive-capture-settings-guard";
import { readExclusiveSetting, setExclusiveSetting } from "@/lib/exclusive-capture-settings";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — Administração" }] }),
  beforeLoad: guardExclusiveSettingsRoute,
  component: AdminSettings,
});

type PanelProps = {
  enabled: boolean | null;
  saving: boolean;
  confirmEnable: boolean;
  onConfirmEnableChange: (open: boolean) => void;
  onChange: (enabled: boolean) => void;
  onReload: () => void;
};

export function ExclusiveSettingsPanel({
  enabled,
  saving,
  confirmEnable,
  onConfirmEnableChange,
  onChange,
  onReload,
}: PanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Captações exclusivas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" aria-live="polite" className="font-medium">
          Estado atual: {enabled === null ? "indisponível" : enabled ? "Ligado" : "Desligado"}
        </p>
        <p className="text-sm text-muted-foreground">
          Desligar impede novos acessos ao módulo, mas preserva captações, documentos e histórico.
        </p>
        {enabled === null ? (
          <Button variant="outline" disabled={saving} onClick={onReload}>
            Consultar estado novamente
          </Button>
        ) : (
          <Button
            variant={enabled ? "destructive" : "default"}
            disabled={saving}
            onClick={() => (enabled ? onChange(false) : onConfirmEnableChange(true))}
          >
            {saving ? "Salvando..." : enabled ? "Desligar captações" : "Ligar captações"}
          </Button>
        )}
        <AlertDialog open={confirmEnable} onOpenChange={onConfirmEnableChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ligar captações exclusivas?</AlertDialogTitle>
              <AlertDialogDescription>
                O módulo ficará disponível aos papéis autorizados. Confirme apenas depois de validar
                o fluxo com usuários autenticados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={saving} onClick={() => onChange(true)}>
                Sim, ligar captações
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function AdminSettings() {
  const { hasRole, loading } = useAuth();
  const canManage = hasRole("super_admin");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);

  const reload = async () => {
    setEnabled(null);
    try {
      setEnabled(await readExclusiveSetting());
    } catch (error) {
      toast.error(errorMessage(error, "Não foi possível consultar a configuração"));
    }
  };

  useEffect(() => {
    if (canManage) void reload();
  }, [canManage]);

  if (loading) return <p>Carregando acesso...</p>;
  if (!canManage) return <p>Apenas Super Admin pode alterar as configurações.</p>;

  const change = async (next: boolean) => {
    if (saving || enabled === null || enabled === next) return;
    setSaving(true);
    try {
      await setExclusiveSetting(next);
      const current = await readExclusiveSetting();
      setEnabled(current);
      if (current !== next)
        throw new Error("Estado alterado por outra sessão; consulte novamente.");
      toast.success(next ? "Captações exclusivas ligadas" : "Captações exclusivas desligadas");
    } catch (error) {
      setEnabled(null);
      toast.error(errorMessage(error, "Não foi possível alterar a configuração"));
    } finally {
      setConfirmEnable(false);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-semibold">Administração → Configurações</h1>
      </div>
      <ExclusiveSettingsPanel
        enabled={enabled}
        saving={saving}
        confirmEnable={confirmEnable}
        onConfirmEnableChange={setConfirmEnable}
        onChange={(next) => void change(next)}
        onReload={() => void reload()}
      />
    </div>
  );
}
