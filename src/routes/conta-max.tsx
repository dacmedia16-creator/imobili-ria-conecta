import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/conta-max")({
  ssr: false,
  component: ContaMaxBridge,
});

function ContaMaxBridge() {
  const router = useRouter();
  const [message, setMessage] = useState("Validando seu acesso pela Conta MAX…");
  const requestStarted = useRef(false);

  useEffect(() => {
    if (requestStarted.current) return;
    requestStarted.current = true;
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    if (!ticket) {
      setMessage("O passe de acesso não foi encontrado.");
      return;
    }

    void (async () => {
      const { data, error } = await supabase.functions.invoke("conta-max-bridge", { body: { ticket } });
      if (error || !data?.access_token || !data?.refresh_token) {
        setMessage("Não foi possível entrar pela Conta MAX. Use o login normal abaixo.");
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionError) {
        setMessage("Não foi possível concluir a sessão. Use o login normal abaixo.");
        return;
      }
      await router.navigate({ to: "/dashboard", replace: true });
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">ADM MAX</h1>
        <p className="mt-3 text-muted-foreground">{message}</p>
        <Link className="mt-5 inline-block underline" to="/auth">Entrar pelo login normal</Link>
      </section>
    </main>
  );
}
