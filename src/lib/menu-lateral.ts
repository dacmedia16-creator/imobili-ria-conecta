import {
  Home,
  Handshake,
  FileSignature,
  Map as MapIcon,
  MapPinned,
  MessageSquareText,
  Gauge,
  LayoutDashboard,
  UsersRound,
  CalendarDays,
  TrendingUp,
  CheckCircle2,
  Landmark,
  Percent,
  BarChart3,
  Wallet,
  Bell,
  ShieldCheck,
  LifeBuoy,
  UserCog,
  Compass,
  Building2,
  Store,
  Settings2,
  Signature,
  Building,
  Users,
  Inbox,
  Radar,
  Trophy,
  Sprout,
  BookOpen,
  Contact,
  KanbanSquare,
  Workflow,
  HeartPulse,
} from "lucide-react";
import { podeAtenderLeads, podeVerPainelLeads } from "@/lib/leads";
import { podeAcessarCentralFinanceira } from "@/lib/financeiro-dashboard-calc";
import { podeVerOcorrenciasConcluidas } from "@/lib/ocorrencias-concluidas";
import { podeAcessarVendasPorRegiao } from "@/lib/vendas-por-regiao";
import { podeAcessarPainelEquipe } from "@/lib/painel-equipe-calc";

// Menu lateral agrupado (maquete aprovada por Denis em 12/10/2026, card t_7f4f77c8).
// Só organiza e muda ícones: cada condição `show` é a MESMA que existia no AppShell antes
// (menu-lateral.test.ts compara item a item com a versão anterior). Rotas, RLS e as
// verificações de servidor continuam sendo a proteção real.

export type NavItem = { to: string; label: string; icon: typeof Home; show: boolean };
export type NavGroup = { label?: string; items: NavItem[]; restricted?: boolean };

export type MenuContexto = {
  roles: readonly string[];
  platformAdmin: boolean;
  exclusiveVisible: boolean;
  roomVisible: boolean;
  feedbackVisible: boolean;
  /** Módulo Oportunidades ligado na imobiliária (opcional: ausente = desligado). */
  opportunitiesVisible?: boolean;
  /** Módulo Mural de Conquistas ligado na imobiliária (opcional: ausente = desligado). */
  achievementsVisible?: boolean;
  /** Módulo Leads (piloto t_2472761a) ligado na imobiliária (opcional: ausente = desligado). */
  leadsVisible?: boolean;
  /** Módulo CRM (dois funis, t_188fb282) ligado: crm E leads (opcional: ausente = desligado). */
  crmVisible?: boolean;
  /** Minha carreira (card t_07d196a7): segue o módulo de captação (opcional: ausente = desligado). */
  carreiraVisible?: boolean;
  /** Dono da plataforma dentro de uma imobiliária ("Entrar como", faixa laranja): esconde os
   * itens da plataforma; a volta é pelo "Sair" da faixa (card t_722085c6). Ausente = fora. */
  inPlatformContext?: boolean;
};

export function montarMenuLateral(ctx: MenuContexto): NavGroup[] {
  const { roles, platformAdmin, exclusiveVisible, roomVisible, feedbackVisible } = ctx;
  const opportunitiesVisible = ctx.opportunitiesVisible === true;
  const achievementsVisible = ctx.achievementsVisible === true;
  const carreiraVisible = ctx.carreiraVisible === true;
  const leadsVisible = ctx.leadsVisible === true;
  const crmVisible = leadsVisible && ctx.crmVisible === true;
  const platformItems = platformAdmin && ctx.inPlatformContext !== true;
  const hasAny = (rs: string[]) => rs.some((r) => roles.includes(r));

  return [
    {
      items: [
        { to: "/dashboard", label: "Início", icon: Home, show: true },
        {
          to: "/minha-carreira",
          label: "Minha carreira",
          icon: Sprout,
          // Mesmos perfis de Captações exclusivas; as RPCs só devolvem dados do próprio usuário.
          show:
            carreiraVisible &&
            hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
        },
      ],
    },
    {
      label: "Vendas e captações",
      items: [
        { to: "/vendas", label: "Vendas", icon: Handshake, show: true },
        {
          to: "/exclusividades",
          label: "Captações exclusivas",
          icon: FileSignature,
          show:
            exclusiveVisible &&
            hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
        },
        {
          to: "/mapa-captacoes",
          label: "Mapa de captações",
          icon: MapIcon,
          // Mesmos 9 perfis que viam o mapa em Vendas por região (Denis, 08/10/2026).
          show: podeAcessarVendasPorRegiao(roles),
        },
        {
          to: "/feedback",
          label: "Feedback ao proprietário",
          icon: MessageSquareText,
          show:
            feedbackVisible &&
            hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
        },
        {
          to: "/oportunidades",
          label: "Oportunidades",
          icon: Radar,
          // Mesmos perfis do Feedback; o banco (RLS + policy do módulo) é a proteção real.
          show:
            opportunitiesVisible &&
            hasAny(["corretor", "gestor", "team_leader", "admin", "super_admin"]),
        },
        {
          to: "/mural-conquistas",
          label: "Mural de Conquistas",
          icon: Trophy,
          // Toda a equipe da imobiliária vê; o banco (policy do módulo + RPCs) é a proteção real.
          show: achievementsVisible,
        },
        {
          to: "/meus-leads",
          label: "Meus leads",
          icon: Contact,
          // Piloto de leads: só com o módulo ligado; o banco (RLS + RPCs) é a proteção real.
          show: leadsVisible && podeAtenderLeads(roles),
        },
        {
          to: "/painel-leads",
          label: "Painel de leads",
          icon: KanbanSquare,
          show: leadsVisible && podeVerPainelLeads(roles),
        },
        {
          to: "/crm",
          label: "CRM",
          icon: Workflow,
          // Dois funis (t_188fb282): só com os módulos CRM e Leads ligados; o banco é a proteção real.
          show: crmVisible && (podeAtenderLeads(roles) || podeVerPainelLeads(roles)),
        },
      ],
    },
    {
      label: "Equipe",
      items: [
        {
          to: "/painel-equipe",
          label: "Painel da Equipe",
          icon: LayoutDashboard,
          // Gestor, Team Leader, líder auxiliar e admin (Denis, 08/10/2026). A RPC restringe à própria equipe.
          show: podeAcessarPainelEquipe(roles),
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
        {
          to: "/ficha-colaboradores",
          label: "Ficha dos colaboradores",
          icon: HeartPulse,
          // Dados sensíveis (t_618b64bc): só staff e administração. O banco (RPC) é a proteção real
          // e também recusa a visão da plataforma e o "Entrar como".
          show:
            hasAny(["staff", "admin", "super_admin"]) && !(platformAdmin && ctx.inPlatformContext),
        },
        // Item 21 (t_0fa570c7): o grupo "Agenda" tinha só este item; mesma condição de antes.
        { to: "/reservas-salas", label: "Reserva de salas", icon: CalendarDays, show: roomVisible },
      ],
    },
    {
      label: "Relatórios detalhados",
      items: [
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
          // Todos os perfis (Denis, 08/10/2026); o banco limita o detalhe ao que cada um já vê.
          show: podeAcessarVendasPorRegiao(roles),
        },
        {
          to: "/ocorrencias-concluidas",
          label: "Ocorrências concluídas",
          icon: CheckCircle2,
          show: podeVerOcorrenciasConcluidas(roles),
        },
        {
          to: "/financeiro",
          label: "Financeiro",
          icon: Landmark,
          show: podeAcessarCentralFinanceira([...roles]),
        },
        {
          to: "/comparativo-comissao",
          label: "Comparativo 6%",
          icon: Percent,
          show: hasAny(["admin", "super_admin", "financeiro"]),
        },
        // "Comissão por Coordenador" saiu do menu em 04/10/2026 (repetia o Desempenho → Por equipe).
        // A rota /comissao-coordenador continua existindo; apagar se ninguém sentir falta em ~30 dias.
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
      ],
    },
    {
      label: "Conta e acesso",
      items: [
        { to: "/notificacoes", label: "Notificações", icon: Bell, show: true },
        { to: "/perfil", label: "Meu acesso", icon: ShieldCheck, show: true },
        // Item 21: "Ajuda e sugestões" é só o botão do topo (abre o formulário); aqui é a lista.
        { to: "/ajuda", label: "Meus chamados", icon: LifeBuoy, show: true },
        // Wiki MAX v4 (t_5e94d050): para todos os logados; o conteúdo filtra pelo papel.
        { to: "/ajuda/wiki", label: "Wiki MAX", icon: BookOpen, show: true },
      ],
    },
    {
      label: "Administração",
      restricted: true,
      items: [
        {
          // Continua visível para gestor e team_leader, como antes (só mudou de grupo).
          to: "/admin/usuarios",
          label: "Usuários",
          icon: UserCog,
          show: hasAny(["admin", "super_admin", "gestor", "team_leader"]),
        },
        {
          to: "/admin/posicionamento",
          label: "Regiões e sugestões",
          icon: Compass,
          show: hasAny(["admin", "super_admin"]),
        },
        {
          to: "/admin/dados-imobiliaria",
          label: "Dados da imobiliária",
          icon: Building2,
          show: hasAny(["admin", "super_admin"]),
        },
        {
          to: "/admin/unidades-captacao",
          label: "Unidades da captação",
          icon: Store,
          show: exclusiveVisible && hasAny(["admin", "super_admin"]),
        },
        {
          to: "/admin/configuracoes",
          label: "Configurações",
          icon: Settings2,
          show: hasAny(["super_admin"]),
        },
        {
          to: "/admin/assinatura-digital",
          label: "Assinatura digital",
          icon: Signature,
          show: hasAny(["super_admin"]),
        },
      ],
    },
    {
      // Item 21 (t_0fa570c7): a plataforma (equipe MAX) em grupo próprio, fora da Administração
      // da imobiliária. Mesma condição de antes (platformItems).
      label: "Plataforma",
      restricted: true,
      items: [
        {
          to: "/plataforma/imobiliarias",
          label: "Painel da Plataforma",
          icon: Building,
          show: platformItems,
        },
        {
          to: "/plataforma/usuarios",
          label: "Usuários da plataforma",
          icon: Users,
          show: platformItems,
        },
        {
          to: "/plataforma/chamados",
          label: "Central de chamados",
          icon: Inbox,
          show: platformItems,
        },
      ],
    },
  ];
}

/** Rótulos visíveis, na ordem do menu (usado em testes e na conferência por papel). */
export function itensVisiveis(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => g.items.filter((i) => i.show).map((i) => i.to));
}

/** Iniciais para o avatar do rodapé (a partir do e-mail). */
export function iniciaisDoEmail(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const partes = local.split(/[._\-+]+/).filter(Boolean);
  const letras = (partes.length >= 2 ? partes[0][0] + partes[1][0] : local.slice(0, 2)) || "?";
  return letras.toUpperCase();
}
