import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
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
  const [modo, setModo] = useState<"login" | "recuperar">("login");
  const [recuperando, setRecuperando] = useState(false);
  const [linkEnviado, setLinkEnviado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/dashboard", replace: true });
    });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao autenticar");
    } finally {
      setLoading(false);
    }
  };

  const onRecuperar = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecuperando(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      if (error) throw error;
      setLinkEnviado(true);
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao enviar o link de recuperação");
    } finally {
      setRecuperando(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <BrandHeroBackground />
        <img src="/remax-logo-white.png" alt="RE/MAX Imóveis — Única Escolha" className="relative z-10 h-14 w-auto self-start" />
        <div className="relative z-10 max-w-sm space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">Da negociação ao contrato assinado, em um só lugar.</h1>
          <p className="text-sm text-white/80">
            Gerencie vendas, contratos e comissões com o fluxo de aprovação completo — corretor, gestor, jurídico e financeiro.
          </p>
        </div>
        <p className="relative z-10 text-xs text-white/60">© {new Date().getFullYear()} RE/MAX Imóveis Única Escolha</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-lg border-0 shadow-lg lg:border lg:shadow-sm">
          <CardHeader className="space-y-3 px-8 pt-8 text-center">
            <img src="/remax-logo.png" alt="RE/MAX Imóveis — Única Escolha" className="mx-auto h-12 w-auto lg:hidden" />
            <CardTitle className="text-xl">Portal Interno</CardTitle>
            <CardDescription>{modo === "login" ? "Acesse com sua conta corporativa" : "Recuperar senha"}</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {modo === "login" ? (
              <>
                <form onSubmit={onSubmit} className="space-y-5">
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
                    <button
                      type="button"
                      onClick={() => { setModo("recuperar"); setLinkEnviado(false); }}
                      className="mt-1.5 text-xs text-primary hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Aguarde..." : "Entrar"}
                  </Button>
                </form>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Cadastro apenas por convite. Peça acesso ao administrador ou ao seu gestor.
                </p>
                <div className="mt-4 border-t pt-4 text-center">
                  <Link to="/especialistas" className="text-sm font-medium text-primary hover:underline">
                    Encontrar um especialista por região
                  </Link>
                </div>
              </>
            ) : linkEnviado ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Se <b>{email}</b> estiver cadastrado, enviamos um link para redefinir a senha. Confira sua caixa de entrada (e o spam).
                </p>
                <button
                  type="button"
                  onClick={() => setModo("login")}
                  className="text-xs text-primary hover:underline"
                >
                  ← Voltar ao login
                </button>
              </div>
            ) : (
              <form onSubmit={onRecuperar} className="space-y-5">
                <div>
                  <Label htmlFor="email-recuperar">E-mail</Label>
                  <Input id="email-recuperar" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={recuperando}>
                  {recuperando ? "Enviando..." : "Enviar link de recuperação"}
                </Button>
                <button
                  type="button"
                  onClick={() => setModo("login")}
                  className="mx-auto block text-xs text-primary hover:underline"
                >
                  ← Voltar ao login
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
