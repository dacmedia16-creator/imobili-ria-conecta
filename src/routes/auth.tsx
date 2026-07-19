import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrar — Portal Imobiliária" }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/", replace: true });
    });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.navigate({ to: "/", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div
        className="hidden w-1/2 flex-col justify-between p-10 text-primary-foreground lg:flex"
        style={{ background: "var(--gradient-remax)" }}
      >
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/remax-icon.png" alt="RE/MAX" className="h-8 w-8" />
          RE/MAX Portal
        </div>
        <div className="max-w-sm space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">Da captação ao contrato assinado, em um só lugar.</h1>
          <p className="text-sm text-primary-foreground/80">
            Gerencie vendas, contratos e comissões com o fluxo de aprovação completo — corretor, gestor, jurídico e financeiro.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">© {new Date().getFullYear()} RE/MAX Portal</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md border-0 shadow-lg lg:border lg:shadow-sm">
          <CardHeader className="space-y-2 text-center">
            <img src="/remax-logo.png" alt="RE/MAX Imóveis — Única Escolha" className="mx-auto h-12 w-auto lg:hidden" />
            <CardTitle>Portal Interno</CardTitle>
            <CardDescription>Acesse com sua conta corporativa</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Aguarde..." : "Entrar"}
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Cadastro apenas por convite. Peça acesso ao administrador ou ao seu gestor.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
