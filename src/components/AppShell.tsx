import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
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
  MapPinned,
  ShieldAlert,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import { podeAcessarCentralFinanceira } from "@/lib/financeiro-dashboard-calc";
import type { ReactNode } from "react";
import { endOperationalImpersonation } from "@/lib/user-impersonation.functions";
import { toast } from "sonner";

type NavItem = { to: string; label: string; icon: typeof Home; show: boolean };
type NavGroup = { label?: string; items: NavItem[]; compact?: boolean };

function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const { user, roles, signOut, impersonation, restoreSuperAdmin } = useAuth();
  const router = useRouter();
  const endImpersonationFn = useServerFn(endOperationalImpersonation);

  const handleSignOut = async () => {
    if (impersonation) {
      try {
        await endImpersonationFn({ data: { auditId: impersonation.auditId } });
      } catch (error) {
        console.error("Falha ao encerrar auditoria da impersonação", error);
      }
      try {
        await restoreSuperAdmin();
        window.location.href = "/admin/usuarios";
      } catch (error: any) {
        toast.error(error?.message ?? "Não foi possível retornar ao Super Admin.");
      }
      return;
    }
    await signOut();
    window.location.assign("https://conta-max-poc.dacmedia16.workers.dev/logout");
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
      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {groups.map((group) => {
          const visible = group.items.filter((n) => n.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.label ?? "principal"} className="space-y-1">
              {group.label && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  {group.label}
                </p>
              )}
              {visible.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  activeOptions={{ exact: n.to === "/" }}
                  onClick={onNavigate}
                  className={`flex touch-manipulation items-center gap-3 rounded-md border-l-2 border-transparent px-3 text-white/85 hover:bg-white/10 hover:text-white ${group.compact ? "py-1.5 text-xs" : "py-2 text-sm"}`}
                  activeProps={{ className: "bg-white/10 border-[#ff3b3b] text-white font-medium" }}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </Link>
              ))}
            </div>
          );
        })}
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
          <LogOut className="h-4 w-4" /> {impersonation ? "Retornar ao Super Admin" : "Sair da Conta MAX"}
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { hasAny, roles, impersonation, restoreSuperAdmin } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const router = useRouter();
  const endImpersonationFn = useServerFn(endOperationalImpersonation);

  const leaveImpersonation = async () => {
    if (!impersonation) return;
    try {
      await endImpersonationFn({ data: { auditId: impersonation.auditId } });
    } catch (error) {
      console.error("Falha ao encerrar auditoria da impersonação", error);
    }
    try {
      await restoreSuperAdmin();
      router.navigate({ to: "/admin/usuarios", replace: true });
      window.location.reload();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível retornar ao Super Admin.");
    }
  };

  const primaryNav: NavItem[] = [
    { to: "/dashboard", label: "Início", icon: Home, show: true },
    { to: "/vendas", label: "Vendas", icon: FileText, show: true },
    {
      to: "/financeiro",
      label: "Financeiro",
      icon: Landmark,
      show: podeAcessarCentralFinanceira(roles),
    },
    {
      to: "/visao-executiva",
      label: "Desempenho",
      icon: Gauge,
      show: hasAny(["gestor", "team_leader", "admin", "super_admin", "financeiro"]),
    },
    {
      to: "/equipe",
      label: "Equipes",
      icon: UsersRound,
      show: hasAny(["gestor", "team_leader", "admin", "super_admin"]),
    },
  ];

  const reportNav: NavItem[] = [
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
      label: "Produção por pessoa",
      icon: TrendingUp,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    {
      to: "/relatorios",
      label: "Relatórios financeiros",
      icon: BarChart3,
      show: hasAny(["financeiro", "admin", "super_admin"]),
    },
    {
      to: "/comissoes-a-receber",
      label: "Baixa de recebimentos",
      icon: Wallet,
      show: hasAny(["financeiro", "admin", "super_admin"]),
    },
  ];

  const accountNav: NavItem[] = [
    { to: "/notificacoes", label: "Notificações", icon: Bell, show: true },
    { to: "/perfil", label: "Meu acesso", icon: ShieldCheck, show: true },
    {
      to: "/admin/usuarios",
      label: "Usuários",
      icon: Users,
      show: hasAny(["admin", "super_admin", "gestor", "team_leader"]),
    },
    {
      to: "/admin/posicionamento",
      label: "Sugestões de regiões",
      icon: MapPinned,
      show: hasAny(["admin", "super_admin"]),
    },
  ];

  const navGroups: NavGroup[] = [
    { items: primaryNav },
    { label: "Relatórios detalhados", items: reportNav, compact: true },
    { label: "Conta e acesso", items: accountNav, compact: true },
  ];

  // print:min-h-0 — sem isso essa div ficava reservando uma tela cheia de altura vazia na
  // impressão (o menu lateral/cabeçalho já somem com print:hidden, mas o min-h-screen continua
  // valendo pro wrapper), empurrando o conteúdo real (ex.: modal Visão geral) pra segunda página,
  // com a primeira saindo em branco.
  return (
    <div className="min-h-screen bg-background print:min-h-0">
      {impersonation && (
        <div className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg print:hidden">
          <ShieldAlert className="h-4 w-4" />
          <span>Modo operacional: você está como {impersonation.targetName}. As ações alteram dados reais.</span>
          <Button size="sm" variant="secondary" onClick={leaveImpersonation}>Retornar ao Super Admin</Button>
        </div>
      )}
      <aside className={`fixed inset-y-0 left-0 hidden w-60 flex-col overflow-hidden border-r border-white/10 text-white md:flex print:hidden ${impersonation ? "pt-12" : ""}`}>
        <BrandHeroBackground />
        <SidebarNav groups={navGroups} />
      </aside>

      <header className={`sticky z-30 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden print:hidden ${impersonation ? "top-12" : "top-0"}`}>
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
              <SidebarNav groups={navGroups} onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className={`md:pl-60 print:pl-0 ${impersonation ? "pt-12" : ""}`}>
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
