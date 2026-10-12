import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
// Login só com Google (t_bcc382de, Denis 12/10/2026): a entrada por e-mail/senha saiu da tela e o servidor
// (hook login_so_google_hook no Supabase Auth) recusa sessão aberta por senha.
const GOOGLE_LOGIN_URL = IS_HOMOLOG
  ? "https://conta.unicaescolha.com.br/login?app=adm-max-homolog"
  : "https://conta.unicaescolha.com.br/login?app=adm-max";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrar — Portal Imobiliária" }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/dashboard", replace: true });
    });
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <BrandHeroBackground />
        {IS_HOMOLOG ? (
          <div className="relative z-10 text-3xl font-bold">
            ADM MAX{" "}
            <span className="block text-sm font-normal text-white/70">Homologação interna</span>
          </div>
        ) : (
          <img
            src="/remax-logo-white.png"
            width={1600}
            height={756}
            alt="RE/MAX Imóveis — Única Escolha"
            className="relative z-10 h-14 w-auto self-start"
          />
        )}
        <div className="relative z-10 max-w-sm space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">
            Da negociação ao contrato assinado, em um só lugar.
          </h1>
          <p className="text-sm text-white/80">
            Gerencie vendas, contratos e comissões com o fluxo de aprovação completo — corretor,
            gestor, jurídico e financeiro.
          </p>
        </div>
        <p className="relative z-10 text-xs text-white/60">
          {IS_HOMOLOG
            ? "ADM MAX · Ambiente de homologação"
            : `© ${new Date().getFullYear()} RE/MAX Imóveis Única Escolha`}
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-lg border-0 shadow-lg lg:border lg:shadow-sm">
          <CardHeader className="space-y-3 px-8 pt-8 text-center">
            {IS_HOMOLOG ? (
              <div className="mx-auto text-2xl font-bold text-[#0b1330] lg:hidden">ADM MAX</div>
            ) : (
              <img
                src="/remax-logo.png"
                width={11134}
                height={5263}
                alt="RE/MAX Imóveis — Única Escolha"
                className="mx-auto h-12 w-auto lg:hidden"
              />
            )}
            <CardTitle className="text-xl">
              {IS_HOMOLOG ? "Demonstração interna" : "Portal Interno"}
            </CardTitle>
            <CardDescription>Acesse com sua conta Google corporativa</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <div className="space-y-4 text-center">
              <Button asChild className="w-full">
                <a href={GOOGLE_LOGIN_URL}>Entrar com Google</a>
              </Button>
              <p className="text-xs text-muted-foreground">
                Use o mesmo e-mail cadastrado no sistema (ex.: seu @remax.com.br).
              </p>
              <p className="text-xs text-muted-foreground">
                Cadastro apenas por convite. Peça acesso ao administrador ou ao seu gestor.
              </p>
            </div>
            {!IS_HOMOLOG && (
              <div className="mt-4 border-t pt-4 text-center">
                <Link
                  to="/especialistas"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Encontrar um especialista por região
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
