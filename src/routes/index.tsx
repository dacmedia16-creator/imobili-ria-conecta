import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, HandCoins, ShieldCheck, UsersRound } from "lucide-react";

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
  { icon: FileText, title: "Vendas e contratos", desc: "Do rascunho à assinatura, tudo num só lugar — sem planilha, sem WhatsApp perdido." },
  { icon: UsersRound, title: "Fluxo por papel", desc: "Corretor, gestor, jurídico e financeiro — cada um vê e aprova só o que é da sua etapa." },
  { icon: HandCoins, title: "Comissões", desc: "Cálculo, divisão e previsão de recebimento acompanhados do início ao fim da venda." },
  { icon: ShieldCheck, title: "Acesso controlado", desc: "Cadastro só por convite, com permissões por papel e trilha de auditoria de cada mudança." },
];

function FrontPage() {
  return (
    <div className="min-h-screen bg-background">
      <header
        className="relative overflow-hidden text-primary-foreground"
        style={{ background: "var(--gradient-remax)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-20 text-center sm:py-28">
          <img
            src="/remax-logo-transparent.png"
            alt="RE/MAX Imóveis — Única Escolha"
            className="h-16 w-auto sm:h-20"
            style={{ filter: "drop-shadow(0 0 10px rgba(255,255,255,0.85)) drop-shadow(0 0 24px rgba(255,255,255,0.55))" }}
          />
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.3em] text-primary-foreground/70">ADM</p>
          <p className="mt-6 text-sm font-medium uppercase tracking-widest text-primary-foreground/80">
            Sistema exclusivo RE/MAX Única Escolha
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
            Da negociação ao contrato assinado, em um só lugar.
          </h1>
          <p className="mt-4 max-w-xl text-primary-foreground/85">
            Portal interno pra gerenciar vendas, contratos e comissões com o fluxo de aprovação
            completo — corretor, gestor, jurídico e financeiro.
          </p>
          <Button asChild size="lg" className="mt-8 bg-white text-primary hover:bg-white/90">
            <Link to="/auth">Entrar no portal</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border p-5 shadow-sm" style={{ boxShadow: "var(--shadow-remax)" }}>
              <Icon className="h-6 w-6 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t px-6 py-8 text-center text-xs text-muted-foreground">
        <p>Acesso apenas por convite. Peça acesso ao administrador ou ao seu gestor.</p>
        <p className="mt-1">© {new Date().getFullYear()} RE/MAX Imóveis Única Escolha</p>
      </footer>
    </div>
  );
}
