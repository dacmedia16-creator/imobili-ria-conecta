import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/conta-max")({
  ssr: false,
  component: ContaMaxBridge,
});

function ContaMaxBridge() {
  const router = useRouter();
  const [message, setMessage] = useState("Validando seu acesso pela Conta MAX…");
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const requestStarted = useRef(false);

  useEffect(() => {
    if (requestStarted.current) return;
    requestStarted.current = true;
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    const returnTo = new URLSearchParams(window.location.search).get("return_to");
    if (!ticket) {
      setMessage("O passe de acesso não foi encontrado.");
      setStatus("error");
      return;
    }

    void (async () => {
      const { data, error } = await supabase.functions.invoke("conta-max-bridge", {
        body: { ticket },
      });
      if (error || !data?.access_token || !data?.refresh_token) {
        setMessage("Não foi possível concluir o acesso pela Conta MAX.");
        setStatus("error");
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) {
        setMessage("Não foi possível concluir a sessão pela Conta MAX.");
        setStatus("error");
        return;
      }
      if (returnTo === "/reservas-salas") {
        await router.navigate({ to: "/reservas-salas", replace: true });
      } else {
        await router.navigate({ to: "/dashboard", replace: true });
      }
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">ADM MAX</h1>
        <div className="mt-4 flex flex-col items-center gap-3" role="status" aria-live="polite">
          {status === "loading" ? (
            <span
              aria-label="Carregando"
              className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary"
            />
          ) : null}
          <p className="text-muted-foreground">{message}</p>
        </div>
      </section>
    </main>
  );
}
