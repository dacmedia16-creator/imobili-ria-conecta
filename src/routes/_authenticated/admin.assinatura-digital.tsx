import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { FileSignature } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { guardExclusiveSettingsRoute } from "@/lib/exclusive-capture-settings-guard";
import {
  callClicksignConfig,
  type ClicksignConfig,
  type ConnectionTest,
} from "@/lib/clicksign-config";
import { ClicksignConfigPanel } from "@/components/clicksign/ClicksignConfigPanel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/visual/base";

// Tela "Assinatura digital" (t_7508c6b6): só super_admin. A rota esconde dos demais; a edge e o
// banco (clicksign_config_authorize) recusam qualquer outro papel e escolhem a org pelo contexto.
export const Route = createFileRoute("/_authenticated/admin/assinatura-digital")({
  head: () => ({ meta: [{ title: "Assinatura digital — Administração" }] }),
  beforeLoad: guardExclusiveSettingsRoute,
  component: AssinaturaDigitalPage,
});

const db = supabase as unknown as SupabaseClient;

function AssinaturaDigitalPage() {
  const { hasRole, loading } = useAuth();
  const canManage = hasRole("super_admin");
  const [config, setConfig] = useState<ClicksignConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastTest, setLastTest] = useState<ConnectionTest | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      setConfig((await callClicksignConfig(db, { action: "view" })).config);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Não foi possível carregar a configuração");
    }
  }, []);

  useEffect(() => {
    if (canManage) void reload();
  }, [canManage, reload]);

  if (loading) return <p>Carregando acesso…</p>;
  if (!canManage) return <p>Apenas o Administrador principal configura a assinatura digital.</p>;

  const run = async (
    body: Parameters<typeof callClicksignConfig>[1],
    ok: string,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await callClicksignConfig(db, body);
      setConfig(res.config);
      if (body.action === "save_secret" && body.kind === "access_token") setLastTest(null);
      if (res.test) {
        setLastTest(res.test);
        if (res.test.ok) toast.success(res.test.message);
        else toast.error(res.test.message);
      } else toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileSignature}
        title="Administração → Assinatura digital"
        description="Liga a assinatura pela Clicksign nesta imobiliária: chave, webhook, quem assina e prazo. Vale para captação e venda."
      />
      {loadError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" onClick={() => void reload()}>
            Tentar de novo
          </Button>
        </div>
      )}
      {!config && !loadError && <p>Carregando configuração…</p>}
      {config && (
        <ClicksignConfigPanel
          config={config}
          busy={busy}
          lastTest={lastTest}
          onSaveSecret={(kind, value) =>
            run(
              { action: "save_secret", kind, value },
              kind === "access_token" ? "Chave de API salva" : "Segredo do webhook salvo",
            )
          }
          onSave={(p) => run({ action: "save", ...p }, "Configuração salva")}
          onTest={() => void run({ action: "test" }, "")}
          onSetEnabled={(on) =>
            void run(
              { action: "set_enabled", on },
              on ? "Assinatura digital ligada" : "Assinatura digital desligada",
            )
          }
          onCopy={(text) => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => toast.success("Endereço copiado"))
              .catch(() => toast.error("Não foi possível copiar; selecione e copie manualmente"));
          }}
        />
      )}
    </div>
  );
}
