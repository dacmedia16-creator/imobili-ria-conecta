import { createFileRoute, Link } from "@tanstack/react-router";
import { anyOf, requireRoles } from "@/lib/route-access";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL, type AppRole } from "@/lib/auth";
import {
  createUser,
  listAgencyRoles,
  listLastSignIns,
  resetUserPassword,
  setUserActive,
  setUserRole,
  updateUser,
} from "@/lib/admin-users.functions";
import {
  decideUserAction,
  grantableRoles,
  type Actor,
  type Decision,
  type ManagedRole,
} from "@/lib/user-management-policy";
import {
  finalizeOperationalImpersonation,
  restoreOperationalImpersonation,
  startOperationalImpersonation,
} from "@/lib/user-impersonation.functions";
import { writeOperationalImpersonation } from "@/lib/user-impersonation";
import { agingInfo } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DESCRICAO_CONFIRMAR_DESATIVAR,
  podeConfirmarDesativar,
  precisaConfirmarStatus,
  tituloConfirmarDesativar,
} from "@/lib/confirmar-desativar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  KeyRound,
  LogIn,
  Pencil,
  RefreshCcw,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { EmptyState, PageHeader } from "@/components/visual/base";
import type { ProfileRow, TeamRow } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import { LOGIN_SO_GOOGLE } from "@/lib/login-so-google";
import { profileRegistrations } from "@/lib/exclusive-captures-db";
import { filterAdminUsers, type UserStatusFilter } from "@/lib/admin-user-filters";
import { paginate } from "@/lib/pagination";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

type AdminUser = Pick<
  ProfileRow,
  "id" | "nome" | "email" | "telefone" | "cpf" | "creci" | "remax_id" | "ativo" | "avatar_url"
>;

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários" }] }),
  beforeLoad: ({ context }) =>
    requireRoles(context.auth, anyOf("admin", "super_admin", "gestor", "team_leader")),
  component: AdminUsers,
});

const USERS_PER_PAGE = 10;

const ROLES: AppRole[] = [
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

// Regra única (user-management-policy.ts): a mesma decisão é repetida no servidor e no banco.
function allowedRolesFor(roles: AppRole[], isPlatformAdmin = false): AppRole[] {
  return grantableRoles(roles as ManagedRole[], { isPlatformAdmin }).filter((r): r is AppRole =>
    (ROLES as string[]).includes(r),
  );
}

// A lista só traz usuários da própria agência (RLS); a tela usa um marcador de agência comum.
const SAME_ORG = "agencia-atual";

function initials(nameOrEmail: string) {
  const base = nameOrEmail.split("@")[0].trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [base.slice(0, 2)];
  return chars.join("").toUpperCase();
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  let out = "";
  const arr = new Uint32Array(14);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
  return out;
}

function AdminUsers() {
  const { hasRole, hasAny, user, roles: myRoles, platformContext, platformAdmin } = useAuth();
  const inPlatform = platformContext !== null;
  /** Na visão da plataforma toda alteração exige motivo (fica na auditoria da imobiliária). */
  const askReason = (acao: string): string | null | undefined => {
    if (!inPlatform) return null;
    const m = window.prompt(
      `${acao}\n\nVocê está na visão da plataforma (${platformContext?.organizationName}). Informe o motivo — ele fica registrado na auditoria:`,
    );
    if (m === null) return undefined;
    if (m.trim().length < 5) {
      toast.error("Informe um motivo com pelo menos 5 caracteres.");
      return undefined;
    }
    return m.trim();
  };
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [registrationLoaded, setRegistrationLoaded] = useState(false);
  const [rolesByUser, setRolesByUser] = useState<Record<string, AppRole[]>>({});
  const [teamLeads, setTeamLeads] = useState<Record<string, string[]>>({});
  const [teamsRaw, setTeamsRaw] = useState<
    { id: string; nome: string; lider_id: string; parent_team_id: string | null }[]
  >([]);
  const [teamMembersRaw, setTeamMembersRaw] = useState<{ membro_id: string; team_id: string }[]>(
    [],
  );
  const [coLeadersRaw, setCoLeadersRaw] = useState<{ team_id: string; user_id: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("todos");
  const [page, setPage] = useState(1);
  const [editingRoles, setEditingRoles] = useState<Record<string, boolean>>({});
  const [lastSignIn, setLastSignIn] = useState<Record<string, string | null>>({});
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: string; nome: string } | null>(
    null,
  );
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState<{
    id: string;
    email: string;
    nome: string;
  } | null>(null);
  const [editingUserFor, setEditingUserFor] = useState<{
    id: string;
    email: string;
    nome: string;
    telefone: string | null;
    cpf: string | null;
    creci: string | null;
    remax_id: string | null;
    emailLocked?: boolean;
    participa_sessenta?: boolean;
  } | null>(null);
  /** "Participa do 60 Dias MAX" por usuário (organization_members.participa_sessenta). */
  const [participaSessenta, setParticipaSessenta] = useState<Record<string, boolean>>({});
  const createUserFn = useServerFn(createUser);
  const listLastSignInsFn = useServerFn(listLastSignIns);
  const listAgencyRolesFn = useServerFn(listAgencyRoles);
  const resetPasswordFn = useServerFn(resetUserPassword);
  const updateUserFn = useServerFn(updateUser);
  const setUserActiveFn = useServerFn(setUserActive);
  const setUserRoleFn = useServerFn(setUserRole);
  const startImpersonationFn = useServerFn(startOperationalImpersonation);
  const finalizeImpersonationFn = useServerFn(finalizeOperationalImpersonation);
  const restoreImpersonationFn = useServerFn(restoreOperationalImpersonation);
  const [enteringAs, setEnteringAs] = useState<string | null>(null);

  const enterAsUser = async (target: AdminUser) => {
    if (!user || !isPlatformInOrg || target.id === user.id || target.ativo === false) return;
    const confirmed = window.confirm(
      `Entrar como ${target.nome || target.email}?\n\nVocê terá exatamente as permissões desse usuário. Criações, edições e exclusões afetarão dados reais e serão auditadas.`,
    );
    if (!confirmed) return;
    setEnteringAs(target.id);
    let saved = false;
    let switchedToTarget = false;
    let auditId: string | null = null;
    try {
      const { data: current } = await supabase.auth.getSession();
      if (!current.session) throw new Error("Sua sessão da plataforma expirou.");
      const result = await startImpersonationFn({ data: { targetUserId: target.id } });
      auditId = result.auditId;
      writeOperationalImpersonation({
        auditId: result.auditId,
        actorUserId: current.session.user.id,
        actorEmail: current.session.user.email ?? "Plataforma",
        targetUserId: result.target.id,
        targetName: result.target.name,
        targetEmail: result.target.email,
        startedAt: new Date().toISOString(),
      });
      saved = true;
      const { error } = await supabase.auth.verifyOtp({
        token_hash: result.tokenHash,
        type: "magiclink",
      });
      if (error) throw error;
      switchedToTarget = true;
      await finalizeImpersonationFn({ data: { auditId: result.auditId } });
      window.location.href = "/dashboard";
    } catch (error: unknown) {
      let restored = false;
      if (saved && switchedToTarget && auditId) {
        // Finalization can fail after the target session is established. Use
        // the same server-side handoff to recover without browser credentials.
        try {
          const result = await restoreImpersonationFn({ data: { auditId } });
          const { error: restoreError } = await supabase.auth.verifyOtp({
            token_hash: result.tokenHash,
            type: "magiclink",
          });
          if (restoreError) throw restoreError;
          restored = true;
        } catch {
          // Keep the metadata when restoration fails so the target session can
          // retry the server-side handoff instead of silently continuing.
        }
      }
      if (!saved || !switchedToTarget || restored) {
        writeOperationalImpersonation(null);
      }
      toast.error(errorMessage(error, "Não foi possível entrar como esse usuário."));
      setEnteringAs(null);
    }
  };

  const load = useCallback(async () => {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, nome, email, telefone, ativo, avatar_url, remax_id");
    // Papéis de toda a agência pelo servidor: a RLS só deixa admin ler papéis de terceiros, e a tela
    // de gestor/team leader precisa saber quem é corretor para oferecer as ações certas.
    let r: { user_id: string; role: string }[] | null = null;
    try {
      r = await listAgencyRolesFn();
    } catch {
      r = (await supabase.from("user_roles").select("user_id, role")).data;
    }
    const { data: teams } = await supabase
      .from("teams")
      .select("id, nome, lider_id, parent_team_id");
    const { data: t } = await supabase.from("team_members").select("membro_id, team_id");
    const { data: cl } = await supabase.from("team_co_leaders").select("team_id, user_id");
    // RLS de organization_members: admin/gestor/team leader leem os membros da própria imobiliária.
    const { data: oms } = await supabase
      .from("organization_members")
      .select("user_id, participa_sessenta");
    setParticipaSessenta(
      Object.fromEntries((oms ?? []).map((m) => [m.user_id, m.participa_sessenta === true])),
    );
    let registrations: Awaited<ReturnType<typeof profileRegistrations>> = [];
    try {
      registrations = await profileRegistrations();
      setRegistrationLoaded(true);
    } catch {
      setRegistrationLoaded(false);
      setEditingUserFor(null);
    }
    const registrationMap = new Map(registrations.map((row) => [row.user_id, row]));
    setUsers(
      (profs ?? []).map((p) => ({
        ...p,
        cpf: registrationMap.get(p.id)?.cpf ?? null,
        creci: registrationMap.get(p.id)?.creci ?? null,
      })),
    );
    setTeamsRaw(teams ?? []);
    setTeamMembersRaw(t ?? []);
    setCoLeadersRaw(cl ?? []);
    listLastSignInsFn()
      .then(setLastSignIn)
      .catch(() => {});
    const map: Record<string, AppRole[]> = {};
    (r ?? []).forEach((x) => {
      if ((ROLES as string[]).includes(x.role)) {
        (map[x.user_id] ??= []).push(x.role as AppRole);
      }
    });
    setRolesByUser(map);

    // Líderes de cada membro = líder (+ líder auxiliar) da equipe/sub-equipe + líder (+ auxiliar)
    // da equipe-mãe (1 nível), igual à hierarquia usada em is_lead_of() — só pra filtrar quem o
    // gestor/team_leader pode ver aqui.
    const teamById: Record<
      string,
      Pick<TeamRow, "id" | "nome" | "lider_id" | "parent_team_id">
    > = {};
    (teams ?? []).forEach((tm) => {
      teamById[tm.id] = tm;
    });
    const coLeadersByTeam: Record<string, string[]> = {};
    (cl ?? []).forEach((x) => {
      (coLeadersByTeam[x.team_id] ??= []).push(x.user_id);
    });
    const tmap: Record<string, string[]> = {};
    (t ?? []).forEach((x) => {
      const team = teamById[x.team_id];
      if (!team) return;
      const lideres = [team.lider_id, ...(coLeadersByTeam[team.id] ?? [])];
      const parent = team.parent_team_id ? teamById[team.parent_team_id] : null;
      if (parent?.lider_id) lideres.push(parent.lider_id);
      if (parent) lideres.push(...(coLeadersByTeam[parent.id] ?? []));
      (tmap[x.membro_id] ??= []).push(...lideres);
    });
    setTeamLeads(tmap);
  }, [listLastSignInsFn, listAgencyRolesFn]);
  useEffect(() => {
    load();
  }, [load]);

  const canManage = hasAny(["admin", "super_admin", "gestor", "team_leader"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  // "Entrar como" e conceder "Administrador principal": só o super-admin da PLATAFORMA, dentro da
  // imobiliária (Painel da Plataforma). O servidor repete a regra (t_44d957b1).
  const isPlatformInOrg = platformAdmin && inPlatform;
  const allowedRoles = useMemo(
    () => allowedRolesFor(myRoles, isPlatformInOrg),
    [myRoles, isPlatformInOrg],
  );

  // Agrupa por equipe (líder + líder auxiliar primeiro, depois membros) — só pra visão de
  // admin/super admin, que vê todo mundo; gestor/team leader já enxerga só a própria equipe,
  // então uma seção só não ajuda muito. "Sem equipe" pega quem não é membro nem líder de nada
  // (jurídico, financeiro, corretor solto, etc.).
  const teamGroups = useMemo(() => {
    const teamById: Record<string, (typeof teamsRaw)[number]> = {};
    teamsRaw.forEach((t) => {
      teamById[t.id] = t;
    });
    const memberIdsByTeam: Record<string, string[]> = {};
    teamMembersRaw.forEach((m) => {
      (memberIdsByTeam[m.team_id] ??= []).push(m.membro_id);
    });
    const coLeaderIdsByTeam: Record<string, string[]> = {};
    coLeadersRaw.forEach((c) => {
      (coLeaderIdsByTeam[c.team_id] ??= []).push(c.user_id);
    });

    const assigned = new Set<string>();
    const topTeams = [...teamsRaw]
      .filter((t) => !t.parent_team_id)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const groups: {
      key: string;
      label: string;
      primaryLeaderId: string;
      coLeaderIds: string[];
      memberIds: string[];
    }[] = [];
    for (const top of topTeams) {
      const subs = teamsRaw
        .filter((t) => t.parent_team_id === top.id)
        .sort((a, b) => a.nome.localeCompare(b.nome));
      for (const t of [top, ...subs]) {
        const coLeaderIds = (coLeaderIdsByTeam[t.id] ?? []).filter((id) => id !== t.lider_id);
        const memberIds = memberIdsByTeam[t.id] ?? [];
        assigned.add(t.lider_id);
        coLeaderIds.forEach((id) => assigned.add(id));
        memberIds.forEach((id) => assigned.add(id));
        groups.push({
          key: t.id,
          label: t.parent_team_id ? `${top.nome} → ${t.nome}` : t.nome,
          primaryLeaderId: t.lider_id,
          coLeaderIds,
          memberIds,
        });
      }
    }
    const semEquipeIds = users.filter((u) => !assigned.has(u.id)).map((u) => u.id);
    return { groups, semEquipeIds };
  }, [teamsRaw, teamMembersRaw, coLeadersRaw, users]);

  if (!canManage)
    return (
      <p className="text-sm text-muted-foreground">
        Você não tem permissão para acessar esta página.
      </p>
    );

  const actor: Actor = {
    userId: user?.id ?? "",
    orgId: SAME_ORG,
    roles: myRoles as ManagedRole[],
    isPlatformAdmin: isPlatformInOrg,
  };
  const decide = (
    u: AdminUser,
    action: "edit_user" | "change_email" | "reset_password" | "set_active" | "change_roles",
    role?: AppRole,
  ): Decision =>
    decideUserAction(
      actor,
      action,
      {
        userId: u.id,
        orgId: SAME_ORG,
        roles: (rolesByUser[u.id] ?? []) as ManagedRole[],
        ledByActor: (teamLeads[u.id] ?? []).includes(user?.id ?? ""),
      },
      role,
    );

  // Papéis e ativação passam pelo servidor (regra única + agência); o banco barra o resto.
  const toggleRole = async (userId: string, role: AppRole, has: boolean) => {
    const motivo = askReason(`${has ? "Retirar" : "Conceder"} o papel ${ROLE_LABEL[role]}`);
    if (motivo === undefined) return;
    try {
      await setUserRoleFn({ data: { userId, role, grant: !has, motivo } });
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Não foi possível alterar o papel."));
    }
    load();
  };

  // Desativar sempre abre o diálogo de confirmação (na plataforma ele também pede o motivo);
  // ativar continua com um clique (na plataforma, com o motivo de sempre).
  const toggleAtivo = async (userId: string, ativo: boolean, nome: string) => {
    if (precisaConfirmarStatus(ativo)) {
      setDeactivateReason("");
      setConfirmDeactivate({ id: userId, nome });
      return;
    }
    const motivo = askReason("Ativar usuário");
    if (motivo === undefined) return;
    try {
      await setUserActiveFn({ data: { userId, ativo: true, motivo } });
      toast.success("Usuário ativado");
      load();
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Não foi possível alterar o status do usuário."));
    }
  };

  const confirmarDesativar = async () => {
    if (!confirmDeactivate || !podeConfirmarDesativar(inPlatform, deactivateReason)) return;
    setDeactivating(true);
    try {
      await setUserActiveFn({
        data: {
          userId: confirmDeactivate.id,
          ativo: false,
          motivo: inPlatform ? deactivateReason.trim() : null,
        },
      });
      toast.success("Usuário desativado");
      setConfirmDeactivate(null);
      load();
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Não foi possível alterar o status do usuário."));
    } finally {
      setDeactivating(false);
    }
  };

  // Filtra usuários visíveis: team leader vê a própria equipe + a si mesmo; gestor vê também
  // todos os corretores da imobiliária (pode editar os dados deles — decisão de 11/10/2026).
  const isGestorView = !isAdminLike && hasRole("gestor");
  const visibleUsers = isAdminLike
    ? users
    : users.filter(
        (u) =>
          u.id === user?.id ||
          (teamLeads[u.id] ?? []).includes(user?.id ?? "") ||
          (isGestorView &&
            (rolesByUser[u.id] ?? []).length > 0 &&
            (rolesByUser[u.id] ?? []).every((x) => x === "corretor")),
      );

  // Equipe em que entra o corretor cadastrado por gestor/team leader (o servidor decide o mesmo:
  // a equipe de nível 1 que ele lidera como titular; senão a mais antiga).
  const ownTeams = teamsRaw.filter((tm) => tm.lider_id === user?.id);
  const ownTeam = ownTeams.find((tm) => !tm.parent_team_id) ?? ownTeams[0] ?? null;
  const leadCreate = !isAdminLike && allowedRoles.length > 0;
  const tlWithoutTeam = leadCreate && !hasRole("gestor") && !ownTeam;

  // Ativos primeiro (por nome), inativos ficam colapsados por padrão pra não tomar conta da tela.
  const sortedUsers = [...visibleUsers].sort((a, b) => {
    if ((a.ativo === false) !== (b.ativo === false)) return a.ativo === false ? 1 : -1;
    return (a.nome || a.email || "").localeCompare(b.nome || b.email || "");
  });

  const filteredUsers = filterAdminUsers(sortedUsers, {
    search,
    role: roleFilter,
    status: statusFilter,
    rolesByUser,
  });
  const activeUsers = filteredUsers.filter((u) => u.ativo !== false);
  const inactiveUsers = filteredUsers.filter((u) => u.ativo === false);
  const {
    items: paginatedActiveUsers,
    currentPage,
    totalPages,
    startIndex: pageStart,
    endIndex: pageEnd,
  } = paginate(activeUsers, page, USERS_PER_PAGE);
  const usersById: Record<string, AdminUser> = {};
  users.forEach((u) => {
    usersById[u.id] = u;
  });

  const renderUserCard = (u: AdminUser, badge?: "Líder" | "Líder auxiliar") => {
    const userRoles = rolesByUser[u.id] ?? [];
    // Mesma regra do servidor (user-management-policy.ts); aqui só decide o que mostrar e explica
    // por que uma ação não está disponível. O servidor e o banco repetem a validação.
    const isSelf = u.id === user?.id;
    const dEdit = decide(u, "edit_user");
    const dReset = decide(u, "reset_password");
    const dActive = decide(u, "set_active");
    const dRoles = decide(u, "change_roles");
    const dEmail = decide(u, "change_email");
    // "Entrar como" nunca em super admin (o servidor também recusa administrador da plataforma).
    const canEnterAs = !(rolesByUser[u.id] ?? []).includes("super_admin");
    const canEditThis = dRoles.allowed;
    // Login só com Google (t_93e80346): "Redefinir senha" saiu da tela (o servidor também recusa).
    const canResetPassword = !LOGIN_SO_GOOGLE && dReset.allowed;
    const canEditData = dEdit.allowed && registrationLoaded;
    const canToggleActive = dActive.allowed;
    const unavailable = isSelf
      ? []
      : [
          ...new Set(
            [dEdit, ...(LOGIN_SO_GOOGLE ? [] : [dReset]), dActive, ...(isAdminLike ? [] : [dRoles])]
              .filter((d): d is Extract<Decision, { allowed: false }> => !d.allowed)
              .map((d) => d.reason),
          ),
        ];
    const isEditingRoles = editingRoles[u.id] === true;
    const ultimoAcesso = lastSignIn[u.id];
    const displayName = u.nome || u.email || u.id;
    return (
      <div
        key={u.id}
        className={`rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md ${u.ativo === false ? "opacity-60" : ""}`}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarImage src={u.avatar_url ?? undefined} alt={displayName} />
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-sm font-medium">
                {u.nome || u.email}
                {badge && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <Crown className="h-3 w-3" />
                    {badge}
                  </span>
                )}
                {u.id === user?.id && (
                  <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                )}
                {u.ativo === false && (
                  <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">
                    Inativo
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{u.email}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Papéis: {userRoles.map((r) => ROLE_LABEL[r]).join(", ") || "—"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Último acesso:{" "}
                {ultimoAcesso === undefined
                  ? "…"
                  : ultimoAcesso === null
                    ? "nunca acessou"
                    : agingInfo(ultimoAcesso).label}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEditData && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditingUserFor({
                    id: u.id,
                    email: u.email ?? "",
                    nome: u.nome ?? "",
                    telefone: u.telefone ?? null,
                    cpf: u.cpf ?? null,
                    creci: u.creci ?? null,
                    remax_id: u.remax_id ?? null,
                    emailLocked: !dEmail.allowed,
                    participa_sessenta: participaSessenta[u.id] === true,
                  })
                }
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                Editar dados
              </Button>
            )}
            {canEditThis && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingRoles((m) => ({ ...m, [u.id]: !m[u.id] }))}
              >
                {isEditingRoles ? "Fechar" : "Editar papéis"}
              </Button>
            )}
            {isPlatformInOrg && canEnterAs && u.id !== user?.id && u.ativo !== false && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => enterAsUser(u)}
                disabled={enteringAs === u.id}
              >
                <LogIn className="mr-1.5 h-4 w-4" />
                {enteringAs === u.id ? "Entrando…" : "Entrar como usuário"}
              </Button>
            )}
            {canResetPassword && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setResetPasswordFor({
                    id: u.id,
                    email: u.email ?? "",
                    nome: u.nome ?? displayName,
                  })
                }
              >
                <KeyRound className="mr-1.5 h-4 w-4" />
                Redefinir senha
              </Button>
            )}
            {canToggleActive && (
              <Button
                size="sm"
                variant={u.ativo === false ? "default" : "outline"}
                onClick={() => toggleAtivo(u.id, u.ativo !== false, displayName)}
              >
                {u.ativo === false ? "Ativar" : "Desativar"}
              </Button>
            )}
          </div>
        </div>
        {unavailable.length > 0 && (
          <div className="mb-2 text-xs text-muted-foreground" data-testid="acoes-indisponiveis">
            Ações indisponíveis: {unavailable.join(" ")}
          </div>
        )}
        {isAdminLike && (
          <div className="text-xs text-muted-foreground">
            Líderes deste usuário:{" "}
            {(teamLeads[u.id] ?? []).length === 0
              ? "nenhum"
              : (teamLeads[u.id] ?? [])
                  .map(
                    (lid) =>
                      users.find((x) => x.id === lid)?.nome ||
                      users.find((x) => x.id === lid)?.email ||
                      lid,
                  )
                  .join(", ")}
            {" — "}
            <Link to="/equipe" className="text-primary hover:underline">
              gerenciar em Equipes →
            </Link>
          </div>
        )}
        {isEditingRoles && canEditThis && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
            {ROLES.filter(
              // "Administrador principal" só aparece para a plataforma ou se o usuário já o tem.
              (r) => r !== "super_admin" || isPlatformInOrg || userRoles.includes(r),
            ).map((r) => {
              const has = userRoles.includes(r);
              const d = decide(u, "change_roles", r);
              const restrict = !d.allowed;
              return (
                <Button
                  key={r}
                  size="sm"
                  variant={has ? "default" : "outline"}
                  onClick={() => toggleRole(u.id, r, has)}
                  disabled={restrict}
                  title={d.allowed ? "" : d.reason}
                >
                  {ROLE_LABEL[r]}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Usuários e perfis"
        description={
          <>
            Você gerencia somente usuários da sua agência.{" "}
            {isAdminLike
              ? 'Só o administrador principal concede ou retira papel de administrador; o papel "Administrador principal" é concedido somente pela plataforma.'
              : "Gestor cadastra corretores e edita os dados dos corretores da imobiliária; team leader cadastra e edita só corretores da própria equipe. Papéis são alterados por administradores."}{" "}
            Novas imobiliárias são cadastradas apenas pelo super-admin da plataforma.
          </>
        }
        actions={
          <>
            {tlWithoutTeam && (
              <p className="max-w-xs text-xs text-muted-foreground" data-testid="tl-sem-equipe">
                Você ainda não lidera nenhuma equipe. Peça a um administrador para criar a sua
                equipe antes de cadastrar corretores.
              </p>
            )}
            {allowedRoles.length > 0 && !tlWithoutTeam && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <UserPlus className="h-4 w-4" /> {leadCreate ? "Novo corretor" : "Novo usuário"}
                  </Button>
                </DialogTrigger>
                <NewUserDialog
                  allowedRoles={allowedRoles}
                  fixedTeamLabel={
                    leadCreate
                      ? (ownTeam?.nome ?? "Uma equipe nova, liderada por você, será criada")
                      : null
                  }
                  onDone={() => {
                    setOpen(false);
                    load();
                  }}
                  createUserFn={createUserFn}
                />
              </Dialog>
            )}
          </>
        }
      />

      <Card className="rounded-xl shadow-sm">
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Lista de usuários</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative w-full min-w-[12rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar por nome ou e-mail"
                className="pl-9"
                placeholder="Buscar por nome ou e-mail…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(v) => {
                setRoleFilter(v as AppRole | "todos");
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filtrar por papel" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os papéis</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as UserStatusFilter);
                setShowInactive(false);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36" aria-label="Filtrar por status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sortedUsers.length === 0 && (
            <EmptyState icon={Users}>Nenhum usuário cadastrado.</EmptyState>
          )}
          {sortedUsers.length > 0 && activeUsers.length === 0 && inactiveUsers.length === 0 && (
            <EmptyState icon={Search}>Nenhum usuário encontrado com esse filtro.</EmptyState>
          )}
          {isAdminLike ? (
            (() => {
              const activeIdSet = new Set(paginatedActiveUsers.map((u) => u.id));
              const visibleGroups = teamGroups.groups
                .map((g) => ({
                  ...g,
                  visiblePrimary: activeIdSet.has(g.primaryLeaderId) ? g.primaryLeaderId : null,
                  visibleCoLeaders: g.coLeaderIds.filter((id) => activeIdSet.has(id)),
                  visibleMembers: g.memberIds.filter((id) => activeIdSet.has(id)),
                }))
                .filter(
                  (g) =>
                    g.visiblePrimary ||
                    g.visibleCoLeaders.length > 0 ||
                    g.visibleMembers.length > 0,
                );
              const visibleSemEquipe = teamGroups.semEquipeIds.filter((id) => activeIdSet.has(id));
              return (
                <>
                  {visibleGroups.map((g) => (
                    <div key={g.key} className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.label}
                      </div>
                      <div className="space-y-2">
                        {g.visiblePrimary && renderUserCard(usersById[g.visiblePrimary], "Líder")}
                        {g.visibleCoLeaders.map((id) =>
                          renderUserCard(usersById[id], "Líder auxiliar"),
                        )}
                        {g.visibleMembers.map((id) => renderUserCard(usersById[id]))}
                      </div>
                    </div>
                  ))}
                  {visibleSemEquipe.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sem equipe
                      </div>
                      <div className="space-y-2">
                        {visibleSemEquipe.map((id) => renderUserCard(usersById[id]))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <div className="space-y-3">{paginatedActiveUsers.map((u) => renderUserCard(u))}</div>
          )}
          {activeUsers.length > USERS_PER_PAGE && (
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Exibindo {pageStart + 1}–{pageEnd} de {activeUsers.length} usuários ativos
              </p>
              <Pagination
                className="mx-0 w-auto justify-start sm:justify-end"
                aria-label="Paginação da lista de usuários"
              >
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Anterior
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-2 text-sm text-muted-foreground" aria-live="polite">
                      Página {currentPage} de {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      aria-label="Próxima página"
                    >
                      Próxima
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
          {statusFilter === "inativos" && inactiveUsers.length > 0 && (
            <div className="space-y-3">{inactiveUsers.map((u) => renderUserCard(u))}</div>
          )}
          {statusFilter === "todos" && inactiveUsers.length > 0 && (
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowInactive((v) => !v)}
              >
                {showInactive
                  ? "Ocultar inativos"
                  : `Mostrar ${inactiveUsers.length} inativo${inactiveUsers.length > 1 ? "s" : ""}`}
              </Button>
              {showInactive && (
                <div className="mt-3 space-y-3">{inactiveUsers.map((u) => renderUserCard(u))}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!confirmDeactivate}
        onOpenChange={(o) => {
          if (!o && !deactivating) setConfirmDeactivate(null);
        }}
      >
        <AlertDialogContent data-testid="confirmar-desativar">
          <AlertDialogHeader>
            <AlertDialogTitle>{tituloConfirmarDesativar(confirmDeactivate?.nome)}</AlertDialogTitle>
            <AlertDialogDescription>{DESCRICAO_CONFIRMAR_DESATIVAR}</AlertDialogDescription>
          </AlertDialogHeader>
          {inPlatform && (
            <ReasonField
              id="desativar-motivo"
              value={deactivateReason}
              onChange={setDeactivateReason}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deactivating || !podeConfirmarDesativar(inPlatform, deactivateReason)}
              onClick={(event) => {
                event.preventDefault();
                void confirmarDesativar();
              }}
            >
              {deactivating ? "Desativando…" : "Desativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!resetPasswordFor} onOpenChange={(o) => !o && setResetPasswordFor(null)}>
        {resetPasswordFor && (
          <ResetPasswordDialog
            target={resetPasswordFor}
            onDone={() => setResetPasswordFor(null)}
            resetFn={resetPasswordFn}
            requireReason={inPlatform}
          />
        )}
      </Dialog>

      <Dialog open={!!editingUserFor} onOpenChange={(o) => !o && setEditingUserFor(null)}>
        {editingUserFor && (
          <EditUserDialog
            target={editingUserFor}
            onDone={() => {
              setEditingUserFor(null);
              load();
            }}
            updateFn={updateUserFn}
            requireReason={inPlatform}
          />
        )}
      </Dialog>
    </div>
  );
}

function ResetPasswordDialog({
  target,
  onDone,
  resetFn,
  requireReason = false,
}: {
  target: { id: string; email: string; nome: string };
  onDone: () => void;
  resetFn: (args: {
    data: { userId: string; password: string; motivo?: string | null };
  }) => Promise<unknown>;
  requireReason?: boolean;
}) {
  const [password, setPassword] = useState(() => genPassword());
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);

  const copyCreds = async () => {
    await navigator.clipboard.writeText(`E-mail: ${target.email}\nSenha: ${password}`);
    toast.success("Credenciais copiadas");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetFn({
        data: { userId: target.id, password, motivo: requireReason ? motivo.trim() : null },
      });
      toast.success(
        `Senha de ${target.nome || target.email} redefinida. Copie e envie a nova senha.`,
        {
          action: { label: "Copiar", onClick: copyCreds },
          duration: 10000,
        },
      );
      onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Falha ao redefinir senha"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Redefinir senha</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Nova senha pra <b>{target.nome || target.email}</b>. A senha antiga deixa de funcionar, e a
        pessoa será obrigada a trocar essa senha no próximo login.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="rp-pass">Nova senha</Label>
          <div className="flex gap-2">
            <Input
              id="rp-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPassword(genPassword())}
              title="Gerar senha"
              aria-label="Gerar senha"
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyCreds}
              title="Copiar credenciais"
              aria-label="Copiar credenciais"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {requireReason && <ReasonField id="rp-motivo" value={motivo} onChange={setMotivo} />}
        <DialogFooter>
          <Button type="submit" disabled={loading || (requireReason && motivo.trim().length < 5)}>
            {loading ? "Salvando…" : "Redefinir senha"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditUserDialog({
  target,
  onDone,
  updateFn,
  requireReason = false,
}: {
  requireReason?: boolean;
  target: {
    id: string;
    email: string;
    nome: string;
    telefone: string | null;
    cpf: string | null;
    creci: string | null;
    remax_id: string | null;
    emailLocked?: boolean;
    participa_sessenta?: boolean;
  };
  onDone: () => void;
  updateFn: (args: {
    data: {
      userId: string;
      nome: string;
      email: string;
      telefone: string;
      cpf: string | null;
      creci: string | null;
      remax_id: string | null;
      participa_sessenta?: boolean;
      motivo?: string | null;
    };
  }) => Promise<unknown>;
}) {
  const [motivo, setMotivo] = useState("");
  const [participa, setParticipa] = useState(target.participa_sessenta === true);
  const [nome, setNome] = useState(target.nome);
  const [email, setEmail] = useState(target.email);
  const [telefone, setTelefone] = useState(target.telefone ?? "");
  const [cpf, setCpf] = useState(target.cpf ?? "");
  const [creci, setCreci] = useState(target.creci ?? "");
  const [remaxId, setRemaxId] = useState(target.remax_id ?? "");
  const [loading, setLoading] = useState(false);

  const nomeCompletoInvalido = nome.trim().split(/\s+/).filter(Boolean).length < 2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nomeCompletoInvalido) {
      e.currentTarget.querySelector<HTMLInputElement>("#eu-nome, #nu-nome")?.focus();
      toast.error("Digite o nome completo (nome e sobrenome).");
      return;
    }
    setLoading(true);
    try {
      await updateFn({
        data: {
          userId: target.id,
          nome,
          email,
          telefone,
          cpf: cpf || null,
          creci: creci || null,
          remax_id: remaxId || null,
          participa_sessenta: participa,
          motivo: requireReason ? motivo.trim() : null,
        },
      });
      toast.success("Dados do usuário atualizados.");
      onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Falha ao atualizar usuário"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Editar dados do usuário</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        Corrige nome, e-mail ou telefone cadastrados errados. Mudar o e-mail também muda o login da
        pessoa.
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="eu-nome">Nome completo</Label>
          <Input
            id="eu-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            placeholder="Nome e sobrenome"
          />
          {nome.trim().length > 0 && nomeCompletoInvalido && (
            <p className="mt-1 text-xs text-destructive">
              Digite o nome completo (nome e sobrenome).
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="eu-email">E-mail</Label>
          <Input
            id="eu-email"
            type="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={target.emailLocked}
          />
          {target.emailLocked && (
            <p className="mt-1 text-xs text-muted-foreground">
              O e-mail é o login da pessoa. Você só pode trocá-lo de corretores da sua equipe.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="eu-telefone">Telefone (WhatsApp)</Label>
          <Input
            id="eu-telefone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            required
            minLength={10}
            placeholder="(11) 91234-5678"
          />
        </div>
        <div>
          <Label htmlFor="eu-cpf">CPF do captador</Label>
          <Input id="eu-cpf" value={cpf} maxLength={30} onChange={(e) => setCpf(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="eu-creci">CRECI</Label>
          <Input
            id="eu-creci"
            value={creci}
            maxLength={50}
            onChange={(e) => setCreci(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="eu-remax-id">ID RE/MAX</Label>
          <Input
            id="eu-remax-id"
            inputMode="numeric"
            placeholder="Ex.: 630601272"
            value={remaxId}
            maxLength={9}
            onChange={(e) => setRemaxId(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div>
            <Label htmlFor="eu-sessenta">Participa do 60 Dias MAX</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Corretores só entram no 60 Dias MAX com esta opção ligada. Donos e gestores ativos
              entram sempre.
            </p>
          </div>
          <Switch id="eu-sessenta" checked={participa} onCheckedChange={setParticipa} />
        </div>
        {requireReason && <ReasonField id="eu-motivo" value={motivo} onChange={setMotivo} />}
        <DialogFooter>
          <Button type="submit" disabled={loading || (requireReason && motivo.trim().length < 5)}>
            {loading ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Motivo obrigatório na visão da plataforma (vai para a auditoria da imobiliária). */
function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/30">
      <Label htmlFor={id}>Motivo (visão da plataforma)</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={5}
        maxLength={300}
        placeholder="Ex.: pedido do administrador da imobiliária"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        Fica registrado na auditoria da imobiliária com o seu nome.
      </p>
    </div>
  );
}

function NewUserDialog({
  allowedRoles,
  fixedTeamLabel = null,
  onDone,
  createUserFn,
}: {
  allowedRoles: AppRole[];
  /** Gestor/team leader: papel fixo de corretor e equipe definida pelo servidor (só exibida). */
  fixedTeamLabel?: string | null;
  onDone: () => void;
  createUserFn: (args: {
    data: { nome: string; email: string; telefone: string; role: AppRole };
  }) => Promise<unknown>;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [role, setRole] = useState<AppRole>(allowedRoles[0]);
  const [loading, setLoading] = useState(false);

  // Convite só com Google (t_93e80346): sem senha inicial. A pessoa entra pelo botão do Google.
  const copyCreds = async () => {
    await navigator.clipboard.writeText(
      `Acesse ${window.location.origin}/auth e clique em "Entrar com Google" usando a conta Google do e-mail ${email}.`,
    );
    toast.success("Instrução de acesso copiada");
  };

  const nomeCompletoInvalido = nome.trim().split(/\s+/).filter(Boolean).length < 2;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nomeCompletoInvalido) {
      e.currentTarget.querySelector<HTMLInputElement>("#eu-nome, #nu-nome")?.focus();
      toast.error("Digite o nome completo (nome e sobrenome).");
      return;
    }
    setLoading(true);
    try {
      await createUserFn({ data: { nome, email, telefone, role } });
      toast.success("Usuário criado. Copie e envie a instrução de acesso pelo Google.", {
        action: { label: "Copiar", onClick: copyCreds },
        duration: 10000,
      });
      onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Falha ao criar usuário"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Novo usuário</DialogTitle>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="nu-nome">Nome completo</Label>
          <Input
            id="nu-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            placeholder="Nome e sobrenome"
          />
          {nome.trim().length > 0 && nomeCompletoInvalido && (
            <p className="mt-1 text-xs text-destructive">
              Digite o nome completo (nome e sobrenome).
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="nu-email">E-mail</Label>
          <Input
            id="nu-email"
            type="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="nu-telefone">Telefone (WhatsApp)</Label>
          <Input
            id="nu-telefone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            required
            minLength={10}
            placeholder="(11) 91234-5678"
          />
        </div>
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="flex-1" data-testid="acesso-google">
            Sem senha: a pessoa entra pelo botão &quot;Entrar com Google&quot;, usando a conta
            Google deste e-mail (ex.: @remax.com.br).
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copyCreds}
            title="Copiar instrução de acesso"
            aria-label="Copiar instrução de acesso"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        {fixedTeamLabel !== null ? (
          <div
            className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm"
            data-testid="cadastro-fixo"
          >
            <div>
              <span className="text-muted-foreground">Papel:</span> {ROLE_LABEL.corretor}
            </div>
            <div>
              <span className="text-muted-foreground">Equipe:</span> {fixedTeamLabel}
            </div>
          </div>
        ) : (
          <div>
            <Label>Papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger aria-label="Papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button type="submit" disabled={loading}>
            {loading ? "Criando…" : "Criar usuário"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
