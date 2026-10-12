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
  Building,
  Users,
  Inbox,
} from "lucide-react";
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
};

export function montarMenuLateral(ctx: MenuContexto): NavGroup[] {
  const { roles, platformAdmin, exclusiveVisible, roomVisible, feedbackVisible } = ctx;
  const hasAny = (rs: string[]) => rs.some((r) => roles.includes(r));

  return [
    { items: [{ to: "/dashboard", label: "Início", icon: Home, show: true }] },
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
      ],
    },
    {
      label: "Agenda",
      items: [
        { to: "/reservas-salas", label: "Reservar sala", icon: CalendarDays, show: roomVisible },
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
        { to: "/ajuda", label: "Ajuda e sugestões", icon: LifeBuoy, show: true },
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
          label: "Sugestões de regiões",
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
          to: "/plataforma/imobiliarias",
          label: "Imobiliárias",
          icon: Building,
          show: platformAdmin,
        },
        {
          to: "/plataforma/usuarios",
          label: "Usuários da plataforma",
          icon: Users,
          show: platformAdmin,
        },
        {
          to: "/plataforma/chamados",
          label: "Central de chamados",
          icon: Inbox,
          show: platformAdmin,
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
