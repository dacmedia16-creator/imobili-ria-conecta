/**
 * Cadastro de imobiliárias pela plataforma (Fase 2b) — lógica de servidor.
 *
 * Autorização em duas camadas:
 * - as mudanças em `organizations` passam pelas RPCs `platform_*` chamadas com o JWT de quem pede
 *   (o banco confere `is_platform_super_admin(auth.uid())`);
 * - o que exige service_role (Auth admin, Storage de logos, contagens) só roda depois de
 *   `assertPlatformAdmin`, que lê `platform_admins` pelo servidor.
 *
 * Convite: `auth.admin.generateLink` devolve o link sem enviar e-mail; Denis copia e entrega.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrgScopeError } from "./org-scope";
import {
  friendlyOrgError,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  onlyDigits,
  type FirstAdminInput,
  type OrganizationForm,
  type OrganizationRow,
  type OrganizationSummary,
  type Step,
  type StepKey,
} from "./platform-organizations";

export const LOGO_BUCKET = "organization-logos";
export type FirstAdminRole = "super_admin" | "admin";

const ORG_COLUMNS =
  "id, slug, nome, status, legacy_default, cnpj, cor_primaria, cor_secundaria, logo_path, created_at";

/** Falha fechada: só quem está em platform_admins passa. */
export async function assertPlatformAdmin(admin: SupabaseClient, callerId: string) {
  const { data, error } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();
  if (error || !data) {
    throw new OrgScopeError(
      "Somente o super-admin da plataforma (Denis) cadastra, edita ou suspende imobiliárias.",
    );
  }
}

export function logoPublicUrl(admin: SupabaseClient, path: string | null): string | null {
  if (!path) return null;
  return admin.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listOrganizations(
  admin: SupabaseClient,
  callerId: string,
): Promise<OrganizationSummary[]> {
  await assertPlatformAdmin(admin, callerId);
  const { data, error } = await admin.from("organizations").select(ORG_COLUMNS).order("nome");
  if (error) throw new Error(error.message);
  const orgs = (data ?? []) as OrganizationRow[];
  const [members, roles] = await Promise.all([
    admin.from("organization_members").select("organization_id").eq("ativo", true),
    admin.from("user_roles").select("organization_id, role").in("role", ["admin", "super_admin"]),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (roles.error) throw new Error(roles.error.message);
  const count = (rows: { organization_id: string }[] | null, id: string) =>
    (rows ?? []).filter((r) => r.organization_id === id).length;
  return orgs.map((o) => ({
    ...o,
    logoUrl: logoPublicUrl(admin, o.logo_path),
    membros: count(members.data, o.id),
    administradores: count(roles.data, o.id),
  }));
}

type StepRunner = {
  steps: Step[];
  run: (key: StepKey, fn: () => Promise<string>) => Promise<boolean>;
  skip: (key: StepKey, message: string) => void;
};

/** Executa etapas em ordem; depois da primeira falha as demais ficam "pulado". */
function stepRunner(): StepRunner {
  const steps: Step[] = [];
  let failed = false;
  return {
    steps,
    async run(key, fn) {
      if (failed) {
        steps.push({ key, status: "pulado", message: "Não executada: etapa anterior falhou." });
        return false;
      }
      try {
        steps.push({ key, status: "ok", message: await fn() });
        return true;
      } catch (e) {
        failed = true;
        const msg = e instanceof Error ? e.message : String(e);
        steps.push({ key, status: "erro", message: friendlyOrgError(msg) });
        return false;
      }
    },
    skip(key, message) {
      steps.push({ key, status: "pulado", message });
    },
  };
}

async function rpcOrThrow(user: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await user.rpc(fn, args);
  if (error) throw new Error(`${error.message} (${error.code ?? ""})`);
  return data;
}

async function saveProfile(user: SupabaseClient, orgId: string, form: OrganizationForm) {
  await rpcOrThrow(user, "platform_update_organization_profile", {
    _id: orgId,
    _cnpj: form.cnpj ? onlyDigits(form.cnpj) : null,
    _cor_primaria: form.corPrimaria || null,
    _cor_secundaria: form.corSecundaria || null,
  });
}

export type LogoUpload = { base64: string; contentType: string };

function decodeLogo(logo: LogoUpload): { bytes: Uint8Array; ext: string } {
  if (!(LOGO_TYPES as readonly string[]).includes(logo.contentType)) {
    throw new Error("Logo deve ser PNG, JPG ou WEBP.");
  }
  let bytes: Uint8Array;
  try {
    // atob existe em Node e em Workers (sem depender de Buffer).
    bytes = Uint8Array.from(atob(logo.base64), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Arquivo de logo inválido.");
  }
  if (bytes.byteLength === 0) throw new Error("Arquivo de logo vazio.");
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new Error("Logo acima de 1 MB.");
  const ext = logo.contentType === "image/png" ? "png" : logo.contentType === "image/webp" ? "webp" : "jpg";
  return { bytes, ext };
}

/** Grava o logo em `<org>/logo-<ts>.<ext>` e remove o anterior. Chamar após assertPlatformAdmin. */
async function storeLogo(admin: SupabaseClient, orgId: string, logo: LogoUpload) {
  const { bytes, ext } = decodeLogo(logo);
  const { data: current } = await admin
    .from("organizations")
    .select("logo_path")
    .eq("id", orgId)
    .maybeSingle();
  if (!current) throw new Error("Imobiliária não encontrada.");
  const path = `${orgId}/logo-${Date.now()}.${ext}`;
  const up = await admin.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: logo.contentType, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { error } = await admin.from("organizations").update({ logo_path: path }).eq("id", orgId);
  if (error) {
    await admin.storage.from(LOGO_BUCKET).remove([path]);
    throw new Error(error.message);
  }
  const old = (current as { logo_path: string | null }).logo_path;
  if (old && old !== path) await admin.storage.from(LOGO_BUCKET).remove([old]);
  return path;
}

async function inviteLink(admin: SupabaseClient, email: string, redirectTo: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(error?.message ?? "Não foi possível gerar o link de convite.");
  }
  return data.properties.action_link;
}

/** Cria o primeiro administrador DENTRO da agência (app_metadata) sem senha e sem e-mail. */
async function createFirstAdmin(
  admin: SupabaseClient,
  orgId: string,
  input: Pick<FirstAdminInput, "nome" | "email">,
  role: FirstAdminRole,
) {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    user_metadata: { nome: input.nome },
    app_metadata: { organization_id: orgId },
  });
  if (error || !data?.user) {
    const msg = error?.message ?? "Falha ao criar usuário";
    if (/already|registered|exists/i.test(msg)) {
      throw new Error("Já existe um usuário com esse e-mail (um e-mail pertence a uma só agência).");
    }
    throw new Error(msg);
  }
  const userId = data.user.id;
  const { data: prof } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();
  if ((prof as { organization_id: string } | null)?.organization_id !== orgId) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error("O usuário não nasceu na imobiliária certa; cadastro desfeito.");
  }
  await admin
    .from("user_roles")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("role", "corretor");
  const ins = await admin.from("user_roles").insert({ organization_id: orgId, user_id: userId, role });
  if (ins.error) throw new Error(ins.error.message);
  return userId;
}

export type CreateOrganizationInput = {
  form: OrganizationForm;
  logo?: LogoUpload | null;
  firstAdmin?: { nome: string; email: string; role: FirstAdminRole } | null;
  redirectTo: string;
};

export type CreateOrganizationResult = {
  organizationId: string | null;
  steps: Step[];
  inviteLink: string | null;
};

/**
 * Fluxo completo do cadastro, com status por etapa. `user` = cliente com o JWT de quem pede
 * (RPCs platform_*), `admin` = service_role (Auth/Storage), usado só depois da verificação.
 */
export async function createOrganizationFlow(
  user: SupabaseClient,
  admin: SupabaseClient,
  callerId: string,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  await assertPlatformAdmin(admin, callerId);
  const r = stepRunner();
  let orgId: string | null = null;
  let link: string | null = null;

  await r.run("organizacao", async () => {
    orgId = (await rpcOrThrow(user, "platform_create_organization", {
      _slug: input.form.slug,
      _nome: input.form.nome,
    })) as string;
    return `Criada: ${input.form.nome} (${input.form.slug}).`;
  });

  const hasProfile = Boolean(input.form.cnpj || input.form.corPrimaria || input.form.corSecundaria);
  if (hasProfile) {
    await r.run("dados", async () => {
      await saveProfile(user, orgId as string, input.form);
      return "CNPJ e cores gravados.";
    });
  } else r.skip("dados", "Sem CNPJ nem cores informados.");

  if (input.logo) {
    await r.run("logo", async () => {
      await storeLogo(admin, orgId as string, input.logo as LogoUpload);
      return "Logo enviado.";
    });
  } else r.skip("logo", "Sem logo informado.");

  if (input.firstAdmin) {
    const fa = input.firstAdmin;
    const created = await r.run("administrador", async () => {
      await createFirstAdmin(admin, orgId as string, fa, fa.role);
      return `${fa.nome} cadastrado como ${fa.role === "super_admin" ? "Super Admin" : "Administrador"} da imobiliária.`;
    });
    if (created) {
      await r.run("convite", async () => {
        link = await inviteLink(admin, fa.email, input.redirectTo);
        return "Link gerado. Nenhum e-mail foi enviado: copie e entregue ao administrador.";
      });
    } else r.skip("convite", "Sem administrador cadastrado.");
  } else {
    r.skip("administrador", "Sem administrador informado; cadastre depois.");
    r.skip("convite", "Sem administrador cadastrado.");
  }
  return { organizationId: orgId, steps: r.steps, inviteLink: link };
}

export type UpdateOrganizationInput = {
  organizationId: string;
  form: OrganizationForm;
  logo?: LogoUpload | null;
};

export async function updateOrganizationFlow(
  user: SupabaseClient,
  admin: SupabaseClient,
  callerId: string,
  input: UpdateOrganizationInput,
): Promise<{ steps: Step[] }> {
  await assertPlatformAdmin(admin, callerId);
  const r = stepRunner();
  await r.run("organizacao", async () => {
    await rpcOrThrow(user, "platform_update_organization", {
      _id: input.organizationId,
      _nome: input.form.nome,
      _slug: input.form.slug,
    });
    return "Nome e identificador salvos.";
  });
  await r.run("dados", async () => {
    await saveProfile(user, input.organizationId, input.form);
    return "CNPJ e cores salvos.";
  });
  if (input.logo) {
    await r.run("logo", async () => {
      await storeLogo(admin, input.organizationId, input.logo as LogoUpload);
      return "Logo substituído.";
    });
  } else r.skip("logo", "Logo mantido.");
  return { steps: r.steps };
}

export async function setOrganizationStatus(
  user: SupabaseClient,
  admin: SupabaseClient,
  callerId: string,
  organizationId: string,
  status: "ativa" | "suspensa",
) {
  await assertPlatformAdmin(admin, callerId);
  try {
    await rpcOrThrow(user, "platform_set_organization_status", { _id: organizationId, _status: status });
  } catch (e) {
    throw new Error(friendlyOrgError(e instanceof Error ? e.message : String(e)));
  }
}

/** Primeiro administrador para imobiliária já cadastrada (ou novo convite para quem já existe). */
export async function inviteOrganizationAdmin(
  admin: SupabaseClient,
  callerId: string,
  input: FirstAdminInput & { role: FirstAdminRole; redirectTo: string },
): Promise<{ steps: Step[]; inviteLink: string | null }> {
  await assertPlatformAdmin(admin, callerId);
  const r = stepRunner();
  let link: string | null = null;
  const { data: org } = await admin
    .from("organizations")
    .select("id, status")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (!org || (org as { status: string }).status !== "ativa") {
    throw new OrgScopeError("Imobiliária não encontrada ou suspensa.");
  }
  // Usuário já existe nesta agência? Só gera novo link (sem mexer em papel nem em agência).
  const { data: existing } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("email", input.email)
    .maybeSingle();
  const existingOrg = (existing as { organization_id: string } | null)?.organization_id;
  if (existing && existingOrg !== input.organizationId) {
    throw new OrgScopeError("Esse e-mail já pertence a outra imobiliária.");
  }
  if (existing) {
    r.skip("administrador", "Usuário já cadastrado nesta imobiliária.");
  } else {
    await r.run("administrador", async () => {
      await createFirstAdmin(admin, input.organizationId, input, input.role);
      return `${input.nome} cadastrado.`;
    });
  }
  await r.run("convite", async () => {
    link = await inviteLink(admin, input.email, input.redirectTo);
    return "Link gerado. Nenhum e-mail foi enviado: copie e entregue ao administrador.";
  });
  return { steps: r.steps, inviteLink: link };
}
