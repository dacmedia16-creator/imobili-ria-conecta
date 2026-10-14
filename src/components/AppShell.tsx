import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  LogOut,
  Menu,
  ShieldAlert,
  Building2,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
  Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { montarMenuLateral, iniciaisDoEmail, type NavGroup } from "@/lib/menu-lateral";
import { AjudaSugestoesBotao } from "@/components/AjudaSugestoes";
import { BrandHeroBackground } from "@/components/BrandHeroBackground";
import type { ReactNode } from "react";
import { endOperationalImpersonation } from "@/lib/user-impersonation.functions";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { exclusiveEnabled } from "@/lib/exclusive-captures-db";
import { roomReservationEnabled } from "@/lib/room-reservation-module";
import { ownerFeedbackEnabled } from "@/lib/owner-feedback-module";
import { opportunitiesEnabled } from "@/lib/oportunidades-module";
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
const MENU_RECOLHIDO_KEY = "adm-max:menu-recolhido";
type AgencyBrand = { nome: string; logoUrl: string | null; color: string | null };

function SidebarNav({
  groups,
  onNavigate,
  platformAdmin,
  agencyBrand,
  collapsed = false,
  onToggleCollapsed,
  unread,
  impersonationBanner,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
  platformAdmin: boolean;
  agencyBrand: AgencyBrand | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  unread: number;
  impersonationBanner?: ReactNode;
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
    window.location.assign(IS_HOMOLOG ? "/auth" : "https://conta.unicaescolha.com.br/logout");
  };

  const signOutLabel = impersonation
    ? "Retornar ao Super Admin"
    : IS_HOMOLOG
      ? "Sair da homologação"
      : "Sair da Conta MAX";
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const papeis = [
    IS_HOMOLOG && platformAdmin ? "Super-admin da plataforma" : null,
    roles.length > 0 ? roles.map((r) => ROLE_LABEL[r]).join(", ") : null,
    !platformAdmin && roles.length === 0 ? "Sem papel" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Com o menu recolhido, cada ícone ganha tooltip com o nome do item.
  const withTip = (label: string, node: ReactNode) =>
    collapsed ? (
      <Tooltip key={label}>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      node
    );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        {impersonationBanner}
        <div
          className={`flex items-center gap-2 border-b border-white/10 py-4 ${collapsed ? "flex-col px-2" : "px-5"}`}
          style={IS_HOMOLOG && agencyBrand?.color ? { borderColor: agencyBrand.color } : undefined}
        >
          {IS_HOMOLOG ? (
            agencyBrand?.logoUrl ? (
              <img
                src={agencyBrand.logoUrl}
                alt={`Logo ${agencyBrand.nome}`}
                className="h-8 w-8 shrink-0 object-contain"
              />
            ) : (
              <Building2 className="h-8 w-8 shrink-0" aria-hidden />
            )
          ) : (
            <img
              src="/remax-icon.png"
              width={4500}
              height={4500}
              alt="RE/MAX"
              className="h-8 w-8 shrink-0"
            />
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-semibold tracking-tight">
                {IS_HOMOLOG ? "ADM MAX · Homologação" : "ADM MAX"}
              </span>
              <span className="block truncate text-xs text-white/70">
                {platformAdmin && !platformContext
                  ? "Plataforma"
                  : (agencyBrand?.nome ?? (IS_HOMOLOG ? "Agência não identificada" : "\u00a0"))}
              </span>
            </div>
          )}
          {onToggleCollapsed &&
            withTip(
              "Expandir menu",
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
                aria-expanded={!collapsed}
                title={collapsed ? undefined : "Recolher menu"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>,
            )}
        </div>
        <nav
          aria-label="Menu principal"
          className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-3 ${collapsed ? "px-2" : "px-3"}`}
        >
          {groups.map((group) => {
            const visible = group.items.filter((n) => n.show);
            if (visible.length === 0) return null;
            return (
              <div key={group.label ?? "principal"} className="space-y-0.5">
                {group.label &&
                  (collapsed ? (
                    <div className="mx-2 mb-1 border-t border-white/10" aria-hidden />
                  ) : (
                    <p className="flex items-center gap-1.5 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                      {group.label}
                      {group.restricted && (
                        <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-amber-300/90">
                          <Lock className="h-2.5 w-2.5" aria-hidden />
                          restrito
                        </span>
                      )}
                    </p>
                  ))}
                {visible.map((n) => {
                  const badge = n.to === "/notificacoes" && unread > 0;
                  return withTip(
                    badge ? `${n.label} (${unreadLabel} não lidas)` : n.label,
                    <Link
                      key={n.to}
                      to={n.to}
                      activeOptions={{ exact: n.to === "/" }}
                      onClick={onNavigate}
                      aria-label={
                        collapsed || badge
                          ? badge
                            ? `${n.label}, ${unreadLabel} não lidas`
                            : n.label
                          : undefined
                      }
                      className={`relative flex touch-manipulation items-center rounded-md border-l-2 border-transparent py-2 text-sm text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.45)] hover:bg-white/15 hover:text-white ${collapsed ? "justify-center px-0" : "gap-3 px-3"}`}
                      activeProps={{
                        className: "bg-[#3453a4]/55 border-[#ff3b3b] text-white font-medium",
                      }}
                    >
                      <n.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate" title={n.label}>
                          {n.label}
                        </span>
                      )}
                      {badge &&
                        (collapsed ? (
                          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#ff3b3b]" />
                        ) : (
                          <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#e11d2a] px-1.5 text-[11px] font-semibold leading-5 text-white">
                            {unreadLabel}
                          </span>
                        ))}
                    </Link>,
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className={`border-t border-white/10 text-xs ${collapsed ? "p-2" : "p-3"}`}>
          {collapsed ? (
            withTip(
              `${user?.email ?? ""}${papeis ? ` — ${papeis}` : ""}`,
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#3453a4] text-[11px] font-semibold">
                {iniciaisDoEmail(user?.email)}
              </div>,
            )
          ) : (
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3453a4] text-[11px] font-semibold">
                {iniciaisDoEmail(user?.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white" title={user?.email ?? undefined}>
                  {user?.email}
                </div>
                {papeis && (
                  <div className="truncate text-white/70" title={papeis}>
                    {papeis}
                  </div>
                )}
              </div>
            </div>
          )}
          {withTip(
            signOutLabel,
            <Button
              variant="ghost"
              size="sm"
              aria-label={collapsed ? signOutLabel : undefined}
              className={`w-full gap-2 text-white hover:bg-white/10 hover:text-white ${collapsed ? "justify-center px-0" : "justify-start"} ${impersonation ? "bg-[#7f1d1d]/70" : ""}`}
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && signOutLabel}
            </Button>,
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
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
  // Menu recolhido (só ícones) no desktop; preferência guardada neste navegador.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(MENU_RECOLHIDO_KEY) === "1");
    } catch {
      /* navegador sem localStorage: fica expandido */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((atual) => {
      const novo = !atual;
      try {
        window.localStorage.setItem(MENU_RECOLHIDO_KEY, novo ? "1" : "0");
      } catch {
        /* ignora */
      }
      return novo;
    });
  };
  const [exclusiveVisible, setExclusiveVisible] = useState(false);
  const [roomVisible, setRoomVisible] = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [opportunitiesVisible, setOpportunitiesVisible] = useState(false);
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
    ownerFeedbackEnabled().then((enabled) => {
      if (alive) setFeedbackVisible(enabled);
    });
    opportunitiesEnabled().then((enabled) => {
      if (alive) setOpportunitiesVisible(enabled);
    });
    if (userId) {
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

  const navGroups: NavGroup[] = montarMenuLateral({
    roles,
    platformAdmin,
    exclusiveVisible,
    roomVisible,
    feedbackVisible,
    opportunitiesVisible,
  });
  const unread = useUnreadNotifications();
  // Na sessão "Ver como" os papéis carregados já são os da pessoa vista.
  const papelVerComo = roles.map((r) => ROLE_LABEL[r]).join(", ");
  // Dentro da gaveta do celular a faixa "Ver como" fica no topo do próprio menu.
  const drawerImpersonationBanner = impersonation ? (
    <div
      role="status"
      data-testid="impersonation-banner-drawer"
      className="flex flex-col gap-2 bg-red-700 px-4 py-3 pr-10 text-sm font-semibold text-white"
    >
      <span className="flex items-start gap-2">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Você está vendo como {impersonation.targetName}
          {papelVerComo ? ` (${papelVerComo})` : ""}
        </span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="w-full bg-white text-red-800 hover:bg-red-50"
        onClick={leaveImpersonation}
      >
        <Undo2 className="h-4 w-4" aria-hidden />
        Voltar ao Super Admin
      </Button>
    </div>
  ) : null;

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
        <div
          role="status"
          data-testid="impersonation-banner"
          className="fixed inset-x-0 top-0 z-[100] flex h-12 items-center justify-center gap-2 bg-red-700 px-3 text-sm font-semibold text-white shadow-lg md:gap-3 md:px-4 print:hidden"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          {/* Uma linha só, em qualquer largura: a faixa ocupa exatamente os 48px reservados (pt-12). */}
          <span className="min-w-0 truncate">
            <span className="hidden sm:inline">Você está vendo como </span>
            <span className="sm:hidden">Vendo como </span>
            <span className="underline">{impersonation.targetName}</span>
            {papelVerComo ? ` (${papelVerComo})` : ""}
            <span className="hidden lg:inline"> — as ações alteram dados reais.</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 bg-white text-red-800 hover:bg-red-50"
            onClick={leaveImpersonation}
            aria-label="Voltar ao Super Admin"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Voltar ao Super Admin</span>
            <span className="sm:hidden">Voltar</span>
          </Button>
        </div>
      )}
      <aside
        className={`fixed inset-y-0 left-0 hidden flex-col overflow-hidden border-r border-white/10 text-white transition-[width] duration-200 md:flex print:hidden ${collapsed ? "w-16" : "w-60"} ${topBar ? "pt-12" : ""}`}
      >
        <BrandHeroBackground />
        <div className="pointer-events-none absolute inset-0 z-[1] bg-[#030a23]/85" />
        <SidebarNav
          groups={navGroups}
          platformAdmin={platformAdmin}
          agencyBrand={agencyBrand}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          unread={unread}
        />
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
              : platformAdmin && !platformContext
                ? "ADM MAX · Plataforma"
                : agencyBrand?.nome
                  ? `ADM MAX · ${agencyBrand.nome}`
                  : "ADM MAX"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <AjudaSugestoesBotao compacto />
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
              className={`w-72 overflow-hidden border-0 p-0 text-white [&>button]:z-20 [&>button]:text-white ${topBar ? "pt-12 [&>button]:top-16" : ""}`}
            >
              <BrandHeroBackground />
              <div className="pointer-events-none absolute inset-0 z-[1] bg-[#030a23]/85" />
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <SheetDescription className="sr-only">Links de navegação do portal</SheetDescription>
              <SidebarNav
                groups={navGroups}
                platformAdmin={platformAdmin}
                agencyBrand={agencyBrand}
                unread={unread}
                impersonationBanner={drawerImpersonationBanner}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main
        id="conteudo-principal"
        tabIndex={-1}
        className={`transition-[padding] duration-200 print:pl-0 ${collapsed ? "md:pl-16" : "md:pl-60"} ${topBar ? "pt-12" : ""}`}
      >
        <div className="mx-auto max-w-6xl p-4 md:p-8 print:max-w-none print:p-0">
          <div className="mb-4 hidden items-center justify-end gap-2 md:flex print:hidden">
            <AjudaSugestoesBotao />
            <NotificationBell />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
