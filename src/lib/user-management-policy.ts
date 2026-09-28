/**
 * Fronteira admin/gestor (multiempresa, marco 1e) — regra ÚNICA usada pelo servidor e pela tela.
 *
 * A tela usa estas funções só para mostrar/ocultar botões e explicar o motivo; o servidor repete a
 * mesma decisão antes de usar o service_role, e o banco (RLS + gatilhos) barra as tentativas diretas.
 *
 * Decisões de Denis (27/09/2026):
 * - admin e gestor cadastram/editam/desativam usuários SOMENTE da própria agência;
 * - gestor não cria nem promove administrador e não altera o próprio papel;
 * - só o super-admin da plataforma cria/edita/suspende imobiliárias;
 * - nenhum papel de agência move usuário entre agências.
 */
export type ManagedRole =
  | "corretor"
  | "coordenador"
  | "gestor"
  | "team_leader"
  | "juridico"
  | "financeiro"
  | "lancamento"
  | "admin"
  | "super_admin"
  | "staff";

export const ALL_MANAGED_ROLES: ManagedRole[] = [
  "corretor",
  "gestor",
  "team_leader",
  "juridico",
  "financeiro",
  "lancamento",
  "admin",
  "super_admin",
  "staff",
];

const ADMIN_LEVEL: ManagedRole[] = ["admin", "super_admin"];
const LEAD_LEVEL: ManagedRole[] = ["gestor", "team_leader"];

export type UserAction =
  | "create_user"
  | "edit_user"
  | "reset_password"
  | "set_active"
  | "change_roles"
  | "move_user_org";

export type OrgAction = "create_org" | "edit_org" | "suspend_org";

export type Actor = {
  userId: string;
  orgId: string | null;
  roles: ManagedRole[];
  isPlatformAdmin?: boolean;
};

export type Target = {
  userId: string;
  orgId: string | null;
  roles: ManagedRole[];
  /** O ator é líder (ou líder auxiliar / líder da equipe-mãe) do alvo — mesma regra de is_lead_of. */
  ledByActor?: boolean;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

const allow: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

export const REASONS = {
  // Não revela se o usuário existe em outra agência.
  otherOrg: "Usuário não encontrado na sua agência.",
  noOrg: "Seu usuário não está vinculado a uma agência ativa.",
  self: "Você não pode fazer isso na própria conta; use a tela \"Meu acesso\".",
  selfRole: "Ninguém altera o próprio papel.",
  noPermission: "Seu perfil não gerencia usuários.",
  leadOnlyCorretor: "Gestor e team leader só gerenciam corretores da própria equipe.",
  leadCreatesOnlyCorretor: "Gestor e team leader só cadastram corretores.",
  leadNoRoles: "Somente administradores alteram papéis.",
  adminGrantsAdmin: "Somente o super admin da agência concede papel de administrador.",
  moveOrg: "Nenhum papel de agência move usuário entre agências.",
  platformOnly: "Somente o super-admin da plataforma (Denis) cadastra, edita ou suspende imobiliárias.",
} as const;

const hasAnyOf = (roles: ManagedRole[], set: ManagedRole[]) => roles.some((r) => set.includes(r));

export const isAdminLevel = (roles: ManagedRole[]) => hasAnyOf(roles, ADMIN_LEVEL);
export const isLeadLevel = (roles: ManagedRole[]) => hasAnyOf(roles, LEAD_LEVEL);
const isOnlyCorretor = (roles: ManagedRole[]) =>
  roles.length > 0 && roles.every((r) => r === "corretor");

/** Papéis que o ator pode atribuir ao cadastrar (ou conceder na edição de papéis). */
export function grantableRoles(actorRoles: ManagedRole[]): ManagedRole[] {
  if (actorRoles.includes("super_admin")) return [...ALL_MANAGED_ROLES];
  if (actorRoles.includes("admin")) return ALL_MANAGED_ROLES.filter((r) => !ADMIN_LEVEL.includes(r));
  if (isLeadLevel(actorRoles)) return ["corretor"];
  return [];
}

/** Cadastro de usuário: sempre na agência de quem cadastra (o servidor não aceita outra). */
export function decideCreateUser(actor: Actor, role: ManagedRole): Decision {
  if (!actor.orgId) return deny(REASONS.noOrg);
  const grantable = grantableRoles(actor.roles);
  if (grantable.length === 0) return deny(REASONS.noPermission);
  if (grantable.includes(role)) return allow;
  if (isLeadLevel(actor.roles) && !isAdminLevel(actor.roles)) return deny(REASONS.leadCreatesOnlyCorretor);
  return deny(REASONS.adminGrantsAdmin);
}

/** Ações sobre um usuário existente. `role` é usado em change_roles (papel concedido/removido). */
export function decideUserAction(
  actor: Actor,
  action: Exclude<UserAction, "create_user">,
  target: Target,
  role?: ManagedRole,
): Decision {
  if (action === "move_user_org") return deny(REASONS.moveOrg);
  if (!actor.orgId) return deny(REASONS.noOrg);
  if (!target.orgId || target.orgId !== actor.orgId) return deny(REASONS.otherOrg);
  if (actor.userId === target.userId) {
    return deny(action === "change_roles" ? REASONS.selfRole : REASONS.self);
  }

  const actorSuper = actor.roles.includes("super_admin");
  const actorAdmin = isAdminLevel(actor.roles);
  const actorLead = isLeadLevel(actor.roles);

  if (!actorAdmin && !actorLead) return deny(REASONS.noPermission);

  if (actorAdmin) {
    // Legado preservado: admin gerencia qualquer usuário da própria agência, mas só o super admin
    // da agência concede ou retira papel de administrador (mesma regra da policy user_roles).
    if (action === "change_roles" && role && ADMIN_LEVEL.includes(role) && !actorSuper) {
      return deny(REASONS.adminGrantsAdmin);
    }
    return allow;
  }

  // Gestor / team leader: nunca mexe em papéis nem em administradores.
  if (action === "change_roles") return deny(REASONS.leadNoRoles);
  if (!target.ledByActor || isAdminLevel(target.roles)) return deny(REASONS.leadOnlyCorretor);
  // Editar dados cadastrais: qualquer membro da própria equipe (legado). Senha e ativação: só corretor.
  if (action !== "edit_user" && !isOnlyCorretor(target.roles)) return deny(REASONS.leadOnlyCorretor);
  return allow;
}

/** Imobiliárias (organizations): exclusivo do super-admin da plataforma. */
export function decideOrgAction(actor: Actor, _action: OrgAction): Decision {
  return actor.isPlatformAdmin ? allow : deny(REASONS.platformOnly);
}
