import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import { FileText, HandCoins, ShieldCheck, Target, UsersRound } from "lucide-react";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: "RE/MAX Única Escolha — Portal Interno" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: FrontPage,
});

const FEATURES = [
  { icon: FileText, lines: ["VENDAS E", "CONTRATOS"] },
  { icon: UsersRound, lines: ["FLUXO POR", "PAPEL"] },
  { icon: HandCoins, lines: ["CONTROLE DE", "COMISSÕES"] },
  { icon: ShieldCheck, lines: ["ACESSO", "CONTROLADO"] },
];

function FrontPage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-white">
      <BrandHeroBackground />

      <div className="relative z-10 flex flex-1 flex-col">
        <div className="flex justify-end px-6 pt-8 sm:px-10 sm:pt-10">
          <img src="/remax-logo-white.png" alt="RE/MAX Imóveis — Única Escolha" className="h-14 w-auto sm:h-16" />
        </div>

        <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-white/70">
            Sistema exclusivo RE/MAX Única Escolha
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            Da negociação ao contrato assinado, em um só lugar.
          </h1>
          <p className="mt-4 max-w-xl text-white/80">
            Portal interno pra gerenciar vendas, contratos e comissões com o fluxo de aprovação
            completo — corretor, gestor, jurídico e financeiro.
          </p>
          <Button asChild size="lg" className="mt-8 bg-white text-primary hover:bg-white/90">
            <Link to="/auth">Entrar no portal</Link>
          </Button>
        </main>

        <footer className="border-t border-white/10 px-6 py-5 sm:px-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6">
            <div className="flex flex-wrap items-center gap-5 sm:gap-7">
              {FEATURES.map(({ icon: Icon, lines }, i) => (
                <div key={lines.join()} className="flex items-center gap-3">
                  {i > 0 && <div className="hidden h-8 w-px bg-white/15 sm:block" />}
                  <Icon className="h-5 w-5 shrink-0 text-[#ff3b3b]" />
                  <div className="text-[11px] font-semibold leading-tight tracking-wide text-white/90">
                    <div>{lines[0]}</div>
                    <div>{lines[1]}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Target className="h-8 w-8 shrink-0 text-white/90" />
              <p className="text-sm font-semibold leading-tight">
                RESULTADOS REAIS.
                <br />
                <span className="text-[#ff3b3b]">OPORTUNIDADE REAL.</span>
              </p>
            </div>
          </div>
          <p className="mx-auto mt-4 max-w-6xl text-center text-xs text-white/50 sm:text-left">
            Acesso apenas por convite. Peça acesso ao administrador ou ao seu gestor. © {new Date().getFullYear()} RE/MAX Imóveis Única Escolha
          </p>
        </footer>
      </div>
    </div>
  );
}
