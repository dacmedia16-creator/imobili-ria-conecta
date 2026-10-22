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
 *
 * Decisão de Denis (21/10/2026, cartão t_44d957b1): "Super Admin" é SÓ o super-admin da plataforma.
 * O papel `super_admin` de agência continua no banco, mas na tela se chama "Administrador principal":
 * faz tudo que o administrador faz, concede/retira papel de administrador na própria agência e
 * acessa Configurações; NÃO concede "Administrador principal" (só a plataforma concede) e não
 * "entra como" outro usuário (exclusivo da plataforma).
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
/** Papel que só o super-admin da plataforma concede ou retira ("Administrador principal"). */
const PLATFORM_GRANTED: ManagedRole[] = ["super_admin"];
const LEAD_LEVEL: ManagedRole[] = ["gestor", "team_leader"];

export type UserAction =
  | "create_user"
  | "edit_user"
  | "change_email"
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
  /** O alvo é administrador da plataforma (tabela platform_admins). Lido só pelo servidor. */
  isPlatformAdmin?: boolean;
};

export type Decision = { allowed: true } | { allowed: false; reason: string };

const allow: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

export const REASONS = {
  // Não revela se o usuário existe em outra agência.
  otherOrg: "Usuário não encontrado na sua agência.",
  noOrg: "Seu usuário não está vinculado a uma agência ativa.",
  self: 'Você não pode fazer isso na própria conta; use a tela "Meu acesso".',
  selfRole: "Ninguém altera o próprio papel.",
  noPermission: "Seu perfil não gerencia usuários.",
  leadOnlyCorretor:
    "Gestor gerencia só corretores da imobiliária; team leader, só corretores da própria equipe.",
  leadCreatesOnlyCorretor: "Gestor e team leader só cadastram corretores.",
  leadNoTeam:
    "Você ainda não lidera nenhuma equipe. Peça a um administrador para criar a sua equipe antes de cadastrar corretores.",
  leadNoRoles: "Somente administradores alteram papéis.",
  adminGrantsAdmin: "Somente o administrador principal da agência concede papel de administrador.",
  platformGrantsPrincipal:
    'Somente o super-admin da plataforma concede ou retira o papel "Administrador principal".',
  moveOrg: "Nenhum papel de agência move usuário entre agências.",
  platformOnly:
    "Somente o super-admin da plataforma (Denis) cadastra, edita ou suspende imobiliárias.",
  protectedPlatformAdmin:
    "Esta conta é do administrador da plataforma e não pode ser alterada pela gestão da agência.",
  protectedSuperAdmin:
    "Somente outro administrador principal da agência pode alterar a conta de um administrador principal.",
  impersonateProtected:
    'Não é possível "entrar como" um administrador principal ou o administrador da plataforma.',
  impersonatePlatformOnly: 'Somente o super-admin da plataforma pode "entrar como" outro usuário.',
  leadEmailOnlyTeam:
    "Gestor e team leader só trocam o e-mail de corretores da própria equipe (mesma regra da senha).",
} as const;

const hasAnyOf = (roles: ManagedRole[], set: ManagedRole[]) => roles.some((r) => set.includes(r));

export const isAdminLevel = (roles: ManagedRole[]) => hasAnyOf(roles, ADMIN_LEVEL);
export const isLeadLevel = (roles: ManagedRole[]) => hasAnyOf(roles, LEAD_LEVEL);
const isOnlyCorretor = (roles: ManagedRole[]) =>
  roles.length > 0 && roles.every((r) => r === "corretor");

/**
 * Papéis que o ator pode atribuir ao cadastrar (ou conceder na edição de papéis).
 * `isPlatformAdmin`: super-admin da plataforma (visão de uma imobiliária) concede todos.
 * Administrador principal (super_admin): todos, MENOS "Administrador principal".
 */
export function grantableRoles(
  actorRoles: ManagedRole[],
  opts: { isPlatformAdmin?: boolean } = {},
): ManagedRole[] {
  if (opts.isPlatformAdmin) return [...ALL_MANAGED_ROLES];
  if (actorRoles.includes("super_admin"))
    return ALL_MANAGED_ROLES.filter((r) => !PLATFORM_GRANTED.includes(r));
  if (actorRoles.includes("admin"))
    return ALL_MANAGED_ROLES.filter((r) => !ADMIN_LEVEL.includes(r));
  if (isLeadLevel(actorRoles)) return ["corretor"];
  return [];
}

/** Cadastro de usuário: sempre na agência de quem cadastra (o servidor não aceita outra). */
export function decideCreateUser(actor: Actor, role: ManagedRole): Decision {
  if (!actor.orgId) return deny(REASONS.noOrg);
  const grantable = grantableRoles(actor.roles, { isPlatformAdmin: actor.isPlatformAdmin });
  if (grantable.length === 0) return deny(REASONS.noPermission);
  if (grantable.includes(role)) return allow;
  if (PLATFORM_GRANTED.includes(role) && actor.roles.includes("super_admin"))
    return deny(REASONS.platformGrantsPrincipal);
  if (isLeadLevel(actor.roles) && !isAdminLevel(actor.roles))
    return deny(REASONS.leadCreatesOnlyCorretor);
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

  const actorPlatform = actor.isPlatformAdmin === true;
  const actorSuper = actorPlatform || actor.roles.includes("super_admin");
  const actorAdmin = actorPlatform || isAdminLevel(actor.roles);
  const actorLead = isLeadLevel(actor.roles);

  if (!actorAdmin && !actorLead) return deny(REASONS.noPermission);

  // Contas mais poderosas (achado ALTO, revisão de segurança 12/10/2026 — cartão t_6a39a961):
  // - administrador da plataforma: nenhum papel de agência edita, troca e-mail, redefine senha,
  //   ativa/desativa ou muda papéis (senão um admin de agência viraria dono da plataforma);
  // - super admin da agência: só outro super admin age sobre ele.
  if (target.isPlatformAdmin) return deny(REASONS.protectedPlatformAdmin);
  if (target.roles.includes("super_admin") && !actorSuper) {
    return deny(REASONS.protectedSuperAdmin);
  }

  if (actorAdmin) {
    // "Administrador principal" (super_admin) só é concedido/retirado pela plataforma (21/10/2026).
    if (action === "change_roles" && role && PLATFORM_GRANTED.includes(role) && !actorPlatform) {
      return deny(REASONS.platformGrantsPrincipal);
    }
    // Legado preservado: admin gerencia qualquer usuário da própria agência, mas só o super admin
    // da agência concede ou retira papel de administrador (mesma regra da policy user_roles).
    if (action === "change_roles" && role && ADMIN_LEVEL.includes(role) && !actorSuper) {
      return deny(REASONS.adminGrantsAdmin);
    }
    return allow;
  }

  // Gestor / team leader (decisão de Denis, 11/10/2026 — cartão t_d8d3ada2):
  // - nunca mexe em papéis, administradores ou contas de outros papéis: só corretor puro;
  // - gestor edita dados de corretores de toda a própria imobiliária;
  // - team leader edita só corretores da própria equipe (mesma hierarquia de is_lead_of);
  // - redefinir senha e desativar/reativar ficam IGUAIS ao que já era: só corretores da própria
  //   equipe (não ampliado para a imobiliária inteira).
  // - trocar o E-MAIL (que é o login) segue a regra da senha: só corretores da própria equipe;
  //   senão o gestor trocaria o e-mail para um dele e usaria "esqueci a senha" (achado MÉDIO).
  if (action === "change_roles") return deny(REASONS.leadNoRoles);
  if (!isOnlyCorretor(target.roles)) return deny(REASONS.leadOnlyCorretor);
  if (action === "edit_user" && actor.roles.includes("gestor")) return allow;
  if (!target.ledByActor) {
    return deny(action === "change_email" ? REASONS.leadEmailOnlyTeam : REASONS.leadOnlyCorretor);
  }
  return allow;
}

/**
 * "Entrar como" — QUEM pode: somente o super-admin da plataforma (decisão de Denis, 21/10/2026).
 * Nenhum papel de agência (inclusive "Administrador principal") entra como outro usuário.
 */
export function decideImpersonationActor(actor: Pick<Actor, "isPlatformAdmin">): Decision {
  return actor.isPlatformAdmin === true ? allow : deny(REASONS.impersonatePlatformOnly);
}

/** "Entrar como" usuário: nunca em administrador da plataforma nem em administrador principal. */
export function decideImpersonationTarget(target: Target): Decision {
  if (target.isPlatformAdmin) return deny(REASONS.impersonateProtected);
  if (target.roles.includes("super_admin")) return deny(REASONS.impersonateProtected);
  return allow;
}

/** Imobiliárias (organizations): exclusivo do super-admin da plataforma. */
export function decideOrgAction(actor: Actor, _action: OrgAction): Decision {
  return actor.isPlatformAdmin ? allow : deny(REASONS.platformOnly);
}
