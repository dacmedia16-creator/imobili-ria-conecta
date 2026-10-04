import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  CalendarDays,
  Gauge,
  Percent,
  Landmark,
  Receipt,
  TrendingUp,
  MapPinned,
  ShieldAlert,
  CheckCircle2,
  Settings2,
  Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import { podeAcessarCentralFinanceira } from "@/lib/financeiro-dashboard-calc";
import { podeVerOcorrenciasConcluidas } from "@/lib/ocorrencias-concluidas";
import type { ReactNode } from "react";
import { endOperationalImpersonation } from "@/lib/user-impersonation.functions";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { exclusiveEnabled } from "@/lib/exclusive-captures-db";
import { roomReservationEnabled } from "@/lib/room-reservation-module";
import { fixedLogoForOrganization } from "@/lib/agency-letterhead";
import {
  PLATFORM_PANEL_PATH,
  contextBannerText,
  exitOrganization,
  flagContextExpired,
  formatContextExpiry,
} from "@/lib/platform-context";

// Ao abrir o app, o super-admin da plataforma (fora de contexto) cai no Painel da Plataforma.
let platformLandingHandled = false;

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
type AgencyBrand = { nome: string; logoUrl: string | null; color: string | null };
type NavItem = { to: string; label: string; icon: typeof Home; show: boolean };
type NavGroup = { label?: string; items: NavItem[]; compact?: boolean };

function SidebarNav({
  groups,
  onNavigate,
  platformAdmin,
  agencyBrand,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
  platformAdmin: boolean;
  agencyBrand: AgencyBrand | null;
}) {
  const { user, roles, signOut, impersonation, restoreSuperAdmin, platformContext } = useAuth();
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
      } catch (error: unknown) {
        toast.error(errorMessage(error, "Não foi possível retornar ao Super Admin."));
      }
      return;
    }
    await signOut();
    window.location.assign(
      IS_HOMOLOG ? "/auth" : "https://conta-max-poc.dacmedia16.workers.dev/logout",
    );
  };

  return (
    <div className="relative z-10 flex h-full flex-col">
      <div
        className="flex items-center gap-2 border-b border-white/10 px-5 py-4"
        style={IS_HOMOLOG && agencyBrand?.color ? { borderColor: agencyBrand.color } : undefined}
      >
        {IS_HOMOLOG ? (
          agencyBrand?.logoUrl ? (
            <img
              src={agencyBrand.logoUrl}
              alt={`Logo ${agencyBrand.nome}`}
              className="h-8 w-8 object-contain"
            />
          ) : (
            <Building2 className="h-8 w-8" aria-hidden />
          )
        ) : (
          <img src="/remax-icon.png" width={4500} height={4500} alt="RE/MAX" className="h-8 w-8" />
        )}
        <div className="leading-tight">
          <span className="block font-semibold tracking-tight">
            {IS_HOMOLOG ? "ADM MAX · Homologação" : "RE/MAX Portal"}
          </span>
          <span className="block text-xs text-white/70">
            {IS_HOMOLOG
              ? platformAdmin && !platformContext
                ? "Plataforma"
                : (agencyBrand?.nome ?? "Agência não identificada")
              : "Única Escolha"}
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {groups.map((group) => {
          const visible = group.items.filter((n) => n.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.label ?? "principal"} className="space-y-1">
              {group.label && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                  {group.label}
                </p>
              )}
              {visible.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  activeOptions={{ exact: n.to === "/" }}
                  onClick={onNavigate}
                  className={`flex touch-manipulation items-center gap-3 rounded-md border-l-2 border-transparent px-3 text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.45)] hover:bg-white/15 hover:text-white ${group.compact ? "py-1.5 text-xs" : "py-2 text-sm"}`}
                  activeProps={{
                    className: "bg-[#3453a4]/55 border-[#ff3b3b] text-white font-medium",
                  }}
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
          {IS_HOMOLOG && platformAdmin && (
            <div className="font-semibold text-white">Super-admin da plataforma</div>
          )}
          {roles.length > 0 && <div>{roles.map((r) => ROLE_LABEL[r]).join(", ")}</div>}
          {!platformAdmin && roles.length === 0 && "Sem papel"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-white hover:bg-white/10 hover:text-white"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />{" "}
          {impersonation
            ? "Retornar ao Super Admin"
            : IS_HOMOLOG
              ? "Sair da homologação"
              : "Sair da Conta MAX"}
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
    hasAny,
    roles,
    impersonation,
    restoreSuperAdmin,
    platformAdmin,
    platformContext,
    platformReady,
  } = useAuth();
  const userId = user?.id;
  const contextOrgId = platformContext?.organizationId ?? null;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [exclusiveVisible, setExclusiveVisible] = useState(false);
  const [roomVisible, setRoomVisible] = useState(false);
  const [agencyBrand, setAgencyBrand] = useState<AgencyBrand | null>(null);
  // Super-admin da PLATAFORMA (Denis) — diferente do super_admin de agência. Vem do useAuth e
  // só controla a tela; a rota, o servidor e as RPCs platform_* repetem a verificação.
  // No contexto de uma imobiliária, current_org_id() já devolve a imobiliária do contexto.
  useEffect(() => {
    let alive = true;
    setAgencyBrand(null);
    exclusiveEnabled().then((enabled) => {
      if (alive) setExclusiveVisible(enabled);
    });
    roomReservationEnabled().then((enabled) => {
      if (alive) setRoomVisible(enabled);
    });
    if ((IS_HOMOLOG || contextOrgId) && userId) {
      // A agência vem do JWT no banco, nunca de um seletor do navegador.
      supabase.rpc("current_org_id").then(async ({ data: orgId, error }) => {
        if (error || !orgId) return;
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("nome, logo_path, cor_primaria")
          .eq("id", orgId)
          .maybeSingle();
        if (!alive || orgError || !org) return;
        setAgencyBrand({
          nome: org.nome,
          logoUrl: org.logo_path
            ? supabase.storage.from("organization-logos").getPublicUrl(org.logo_path).data.publicUrl
            : fixedLogoForOrganization(orgId),
          color: org.cor_primaria,
        });
      });
    }
    return () => {
      alive = false;
    };
  }, [userId, contextOrgId]);
  const router = useRouter();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [leavingContext, setLeavingContext] = useState(false);

  useEffect(() => {
    if (!platformReady || platformLandingHandled || !userId) return;
    platformLandingHandled = true;
    if (platformAdmin && !platformContext && pathname === "/dashboard") {
      router.navigate({ to: PLATFORM_PANEL_PATH, replace: true });
    }
  }, [platformReady, platformAdmin, platformContext, pathname, router, userId]);

  // Sair → RPC de saída → recarrega tudo já no Painel (nenhum dado da imobiliária fica na tela).
  const leavePlatformContext = async (expired = false) => {
    if (leavingContext) return;
    setLeavingContext(true);
    if (expired && platformContext) flagContextExpired(platformContext.organizationName);
    try {
      await exitOrganization();
    } catch (error: unknown) {
      if (!expired) {
        toast.error(errorMessage(error, "Não foi possível sair da imobiliária."));
        setLeavingContext(false);
        return;
      }
    }
    window.location.assign(PLATFORM_PANEL_PATH);
  };

  // A sessão de contexto expira em 8h (o banco para de valer sozinho): volta ao painel com aviso.
  const contextExpiresAt = platformContext?.expiresAt ?? null;
  useEffect(() => {
    if (!contextExpiresAt) return;
    const ms = Date.parse(contextExpiresAt) - Date.now();
    const t = window.setTimeout(() => void leavePlatformContext(true), Math.max(ms, 0));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextExpiresAt]);

  const topBar = Boolean(impersonation || platformContext);
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
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Não foi possível retornar ao Super Admin."));
    }
  };

  const primaryNav: NavItem[] = [
    { to: "/dashboard", label: "Início", icon: Home, show: true },
    { to: "/vendas", label: "Vendas", icon: FileText, show: true },
    {
      to: "/exclusividades",
      label: "Captações exclusivas",
      icon: FileText,
      show:
        exclusiveVisible && hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
    },
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
    { to: "/reservas-salas", label: "Reservar sala", icon: CalendarDays, show: roomVisible },
  ];

  const reportNav: NavItem[] = [
    {
      to: "/comparativo-comissao",
      label: "Comparativo 6%",
      icon: Percent,
      show: hasAny(["admin", "super_admin", "financeiro"]),
    },
    // "Comissão por Coordenador" saiu do menu em 04/10/2026 (repetia o Desempenho → Por equipe).
    // A rota /comissao-coordenador continua existindo; apagar se ninguém sentir falta em ~30 dias.
    {
      to: "/producao-por-pessoa",
      label: "Produção por pessoa",
      icon: TrendingUp,
      show: hasAny(["admin", "super_admin", "financeiro", "gestor", "team_leader"]),
    },
    {
      to: "/vendas-por-regiao",
      label: "Vendas por região",
      icon: MapPinned,
      show: hasAny(["admin", "super_admin", "financeiro", "gestor", "team_leader"]),
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
    {
      to: "/ocorrencias-concluidas",
      label: "Ocorrências concluídas",
      icon: CheckCircle2,
      show: podeVerOcorrenciasConcluidas(roles),
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

  const adminNav: NavItem[] = [
    {
      to: "/admin/dados-imobiliaria",
      label: "Dados da imobiliária",
      icon: Building2,
      show: hasAny(["admin", "super_admin"]),
    },
    {
      to: "/admin/unidades-captacao",
      label: "Unidades da captação",
      icon: Building2,
      show: exclusiveVisible && hasAny(["admin", "super_admin"]),
    },
    {
      to: "/admin/configuracoes",
      label: "Configurações",
      icon: Settings2,
      show: hasAny(["super_admin"]),
    },
    {
      to: "/plataforma/imobiliarias",
      label: "Imobiliárias",
      icon: Building2,
      show: platformAdmin,
    },
    {
      to: "/plataforma/usuarios",
      label: "Usuários da plataforma",
      icon: Building2,
      show: platformAdmin,
    },
  ];

  const navGroups: NavGroup[] = [
    { items: primaryNav },
    { label: "Relatórios detalhados", items: reportNav, compact: true },
    { label: "Conta e acesso", items: accountNav, compact: true },
    { label: "Administração", items: adminNav, compact: true },
  ];

  // print:min-h-0 — sem isso essa div ficava reservando uma tela cheia de altura vazia na
  // impressão (o menu lateral/cabeçalho já somem com print:hidden, mas o min-h-screen continua
  // valendo pro wrapper), empurrando o conteúdo real (ex.: modal Visão geral) pra segunda página,
  // com a primeira saindo em branco.
  return (
    <div className="min-h-screen bg-background print:min-h-0">
      <a
        href="#conteudo-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary print:hidden"
      >
        Pular para o conteúdo
      </a>
      {platformContext && !impersonation && (
        <div
          role="status"
          aria-live="polite"
          data-testid="platform-context-banner"
          className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950 shadow-lg print:hidden"
        >
          <span
            className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-950"
            aria-hidden
          />
          <Building2 className="h-4 w-4" aria-hidden />
          <span>
            {contextBannerText(platformContext)} — visão da plataforma, como administrador (até{" "}
            {formatContextExpiry(platformContext)})
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="bg-amber-950 text-white hover:bg-amber-900"
            disabled={leavingContext}
            onClick={() => void leavePlatformContext()}
          >
            {leavingContext ? "Saindo…" : "Sair"}
          </Button>
        </div>
      )}
      {impersonation && (
        <div className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg print:hidden">
          <ShieldAlert className="h-4 w-4" />
          <span>
            Modo operacional: você está como {impersonation.targetName}. As ações alteram dados
            reais.
          </span>
          <Button size="sm" variant="secondary" onClick={leaveImpersonation}>
            Retornar ao Super Admin
          </Button>
        </div>
      )}
      <aside
        className={`fixed inset-y-0 left-0 hidden w-60 flex-col overflow-hidden border-r border-white/10 text-white md:flex print:hidden ${topBar ? "pt-12" : ""}`}
      >
        <BrandHeroBackground />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[#030a23]/85" />
        <SidebarNav groups={navGroups} platformAdmin={platformAdmin} agencyBrand={agencyBrand} />
      </aside>

      <header
        className={`sticky z-30 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden print:hidden ${topBar ? "top-12" : "top-0"}`}
      >
        <div className="flex items-center gap-2">
          {IS_HOMOLOG ? (
            agencyBrand?.logoUrl ? (
              <img
                src={agencyBrand.logoUrl}
                alt={`Logo ${agencyBrand.nome}`}
                className="h-7 w-7 object-contain"
              />
            ) : (
              <Building2 className="h-7 w-7" aria-hidden />
            )
          ) : (
            <img
              src="/remax-icon.png"
              width={4500}
              height={4500}
              alt="RE/MAX"
              className="h-7 w-7"
            />
          )}
          <span className="font-semibold tracking-tight">
            {IS_HOMOLOG
              ? platformAdmin && !platformContext
                ? "ADM MAX · Plataforma"
                : (agencyBrand?.nome ?? "ADM MAX · Homologação")
              : "RE/MAX Portal"}
          </span>
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
              <div className="pointer-events-none absolute inset-0 z-[1] bg-[#030a23]/85" />
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <SheetDescription className="sr-only">Links de navegação do portal</SheetDescription>
              <SidebarNav
                groups={navGroups}
                platformAdmin={platformAdmin}
                agencyBrand={agencyBrand}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main
        id="conteudo-principal"
        tabIndex={-1}
        className={`md:pl-60 print:pl-0 ${topBar ? "pt-12" : ""}`}
      >
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
