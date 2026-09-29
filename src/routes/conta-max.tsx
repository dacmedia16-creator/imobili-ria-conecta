import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { retryContaMaxLogin, startContaMaxBridge, type ContaMaxFailure } from "./conta-max-flow";

export const Route = createFileRoute("/conta-max")({
  ssr: false,
  component: ContaMaxBridge,
});

function ContaMaxBridge() {
  const router = useRouter();
  const [failure, setFailure] = useState<ContaMaxFailure | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    return startContaMaxBridge({
      ticket: params.get("ticket"),
      returnTo: params.get("return_to"),
      invoke: (ticket) => supabase.functions.invoke("conta-max-bridge", { body: { ticket } }),
      setSession: (tokens) => supabase.auth.setSession(tokens),
      navigate: (to) => router.navigate({ to, replace: true }),
      onError: setFailure,
    });
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">ADM MAX</h1>
        <div className="mt-4 flex flex-col items-center gap-3" role="status" aria-live="polite">
          {!failure ? (
            <span
              aria-label="Carregando"
              className="h-8 w-8 animate-spin motion-reduce:animate-none rounded-full border-4 border-muted border-t-primary"
            />
          ) : null}
          <p className="text-muted-foreground">
            {failure ? failure.message : "Validando seu acesso pela Conta MAX…"}
          </p>
          {failure ? (
            <>
              <p className="text-sm text-muted-foreground">
                Código: {failure.code} · Horário: {failure.at.toLocaleTimeString("pt-BR")}
              </p>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                onClick={() =>
                  retryContaMaxLogin({
                    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
                    homolog: import.meta.env.VITE_HOMOLOG_ONLY === "true",
                    returnTo: new URLSearchParams(window.location.search).get("return_to"),
                    storage: window.localStorage,
                    signOut: () => supabase.auth.signOut({ scope: "local" }),
                    replace: (url) => window.location.replace(url),
                  })
                }
              >
                Tentar de novo
              </button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
