import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Home,
  FileText,
  Users,
  UsersRound,
  LogOut,
  Bell,
  ShieldCheck,
  BarChart3,
  Wallet,
  Menu,
  Gauge,
  Percent,
  Landmark,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import { podeAcessarCentralFinanceira } from "@/lib/financeiro-dashboard-calc";
import type { ReactNode } from "react";

type NavItem = { to: string; label: string; icon: typeof Home; show: boolean };

function SidebarNav({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  const { user, roles, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="relative z-10 flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <img src="/remax-icon.png" alt="RE/MAX" className="h-8 w-8" />
        <div className="leading-tight">
          <span className="block font-semibold tracking-tight">RE/MAX Portal</span>
          <span className="block text-xs text-white/70">Única Escolha</span>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              onClick={onNavigate}
              className="flex touch-manipulation items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-white/85 hover:bg-white/10 hover:text-white"
              activeProps={{ className: "bg-white/10 border-[#ff3b3b] text-white font-medium" }}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
      </nav>
      <div className="border-t border-white/10 p-3 text-xs">
        <div className="mb-1 truncate font-medium text-white">{user?.email}</div>
        <div className="mb-2 text-white/70">
          {roles.map((r) => ROLE_LABEL[r]).join(", ") || "Sem papel"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-white hover:bg-white/10 hover:text-white"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { hasAny, roles } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const nav: NavItem[] = [
    { to: "/dashboard", label: "Dashboard", icon: Home, show: true },
    { to: "/vendas", label: "Vendas", icon: FileText, show: true },
    {
      to: "/visao-executiva",
      label: "Visão Executiva",
      icon: Gauge,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    {
      to: "/comparativo-comissao",
      label: "Comparativo 6%",
      icon: Percent,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    {
      to: "/comissao-coordenador",
      label: "Comissão por Coordenador",
      icon: Receipt,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    {
      to: "/producao-por-pessoa",
      label: "Produção por Pessoa",
      icon: TrendingUp,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    // Mesma função usada no beforeLoad da rota (financeiro-dashboard-calc.ts) — fonte única, nunca diverge.
    {
      to: "/financeiro",
      label: "Central Financeira",
      icon: Landmark,
      show: podeAcessarCentralFinanceira(roles),
    },
    {
      to: "/equipe",
      label: "Equipe",
      icon: UsersRound,
      show: hasAny(["gestor", "team_leader", "admin", "super_admin"]),
    },
    {
      to: "/relatorios",
      label: "Relatórios",
      icon: BarChart3,
      show: hasAny(["financeiro", "admin", "super_admin"]),
    },
    {
      to: "/comissoes-a-receber",
      label: "Comissões a Receber",
      icon: Wallet,
      show: hasAny(["financeiro", "admin", "super_admin"]),
    },
    { to: "/notificacoes", label: "Notificações", icon: Bell, show: true },
    { to: "/perfil", label: "Meu acesso", icon: ShieldCheck, show: true },
    {
      to: "/admin/usuarios",
      label: "Usuários",
      icon: Users,
      show: hasAny(["admin", "super_admin", "gestor", "team_leader"]),
    },
  ];

  // print:min-h-0 — sem isso essa div ficava reservando uma tela cheia de altura vazia na
  // impressão (o menu lateral/cabeçalho já somem com print:hidden, mas o min-h-screen continua
  // valendo pro wrapper), empurrando o conteúdo real (ex.: modal Visão geral) pra segunda página,
  // com a primeira saindo em branco.
  return (
    <div className="min-h-screen bg-background print:min-h-0">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-hidden border-r border-white/10 text-white md:flex print:hidden">
        <BrandHeroBackground />
        <SidebarNav nav={nav} />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden print:hidden">
        <div className="flex items-center gap-2">
          <img src="/remax-icon.png" alt="RE/MAX" className="h-7 w-7" />
          <span className="font-semibold tracking-tight">RE/MAX Portal</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <SheetContent
              side="left"
              className="w-72 overflow-hidden border-0 p-0 text-white [&>button]:text-white"
            >
              <BrandHeroBackground />
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <SheetDescription className="sr-only">Links de navegação do portal</SheetDescription>
              <SidebarNav nav={nav} onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="md:pl-60 print:pl-0">
        <div className="mx-auto max-w-6xl p-4 md:p-8 print:max-w-none print:p-0">
          <div className="mb-4 hidden justify-end md:flex print:hidden">
            <NotificationBell />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
