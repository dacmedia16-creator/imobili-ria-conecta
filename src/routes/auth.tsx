import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { contaMaxLoginUrl } from "@/lib/dominios";
import {
  MaxHubAuthShell,
  MaxHubEyebrow,
  MaxHubMark,
  maxHubPrimaryButton,
} from "@/components/MaxHubAuthShell";

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
// Login só com Google (t_bcc382de, Denis 12/10/2026): a entrada por e-mail/senha saiu da tela e o servidor
// (hook login_so_google_hook no Supabase Auth) recusa sessão aberta por senha.
// t_a69e9d11: o login segue o domínio em que a pessoa está (app.somosunihub → conta.somosunihub).
const GOOGLE_LOGIN_URL = contaMaxLoginUrl(IS_HOMOLOG ? "adm-max-homolog" : "adm-max");

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Entrar — ADM MAX" }] }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/dashboard", replace: true });
    });
  }, [router]);

  // Visual no estilo da página MAX HUB (t_610c48f7). Marca neutra antes do login: a imobiliária só é
  // conhecida depois de entrar (t_475d2778).
  return (
    <MaxHubAuthShell
      footer={
        IS_HOMOLOG ? "ADM MAX · Ambiente de homologação" : `© ${new Date().getFullYear()} ADM MAX`
      }
    >
      <div className="grid w-full items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="hidden lg:block">
          <MaxHubEyebrow>
            {IS_HOMOLOG ? "ADM MAX · Homologação interna" : "ADM MAX · Gestão para imobiliárias"}
          </MaxHubEyebrow>
          <h1 className="mt-6 font-maxhub-display text-[clamp(2.6rem,4.6vw,4.2rem)] font-extrabold leading-[0.98] tracking-[-0.04em]">
            Da negociação ao contrato assinado, em um só lugar
            <span className="text-[#dc1c2e]">.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-white/80">
            Gerencie vendas, contratos e comissões com o fluxo de aprovação completo — corretor,
            gestor, jurídico e financeiro.
          </p>
        </div>

        <section
          aria-labelledby="auth-titulo"
          className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-[#071325]/70 p-7 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] backdrop-blur-sm sm:p-9"
        >
          <div className="flex items-center gap-3">
            <MaxHubMark className="h-10 w-10" />
            <div>
              <p className="font-maxhub-display text-lg font-extrabold leading-tight tracking-tight">
                ADM MAX
              </p>
              <p className="text-xs text-[#a9b8cf]">
                {IS_HOMOLOG ? "Homologação interna" : "Gestão para imobiliárias"}
              </p>
            </div>
          </div>

          <h2
            id="auth-titulo"
            className="mt-8 font-maxhub-display text-2xl font-bold tracking-tight"
          >
            {IS_HOMOLOG ? "Demonstração interna" : "Portal Interno"}
          </h2>
          <p className="mt-1.5 text-sm text-white/75">Acesse com sua conta Google corporativa</p>

          <a href={GOOGLE_LOGIN_URL} className={`${maxHubPrimaryButton} mt-7 w-full`}>
            Entrar com Google
            <ArrowRight
              size={18}
              strokeWidth={2}
              className="transition-transform duration-300 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </a>

          <div className="mt-5 space-y-2 text-center text-xs leading-relaxed text-[#a9b8cf]">
            <p>Use o mesmo e-mail cadastrado no sistema (ex.: seu @remax.com.br).</p>
            <p>Cadastro apenas por convite. Peça acesso ao administrador ou ao seu gestor.</p>
          </div>

          {!IS_HOMOLOG && (
            <div className="mt-6 border-t border-white/10 pt-5 text-center">
              <Link
                to="/especialistas"
                className="text-sm font-semibold text-[#8fb4e8] underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                Encontrar um especialista por região
              </Link>
            </div>
          )}
        </section>
      </div>
    </MaxHubAuthShell>
  );
}
