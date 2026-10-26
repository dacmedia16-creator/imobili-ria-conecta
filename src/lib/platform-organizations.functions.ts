import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  firstAdminSchema,
  LOGO_TYPES,
  ORGANIZATION_MODULES,
  organizationFormSchema,
} from "@/lib/platform-organizations";

/**
 * Cadastro de imobiliárias (Fase 2b) — funções de servidor. Toda a lógica e as verificações ficam em
 * `platform-organizations.server.ts`; aqui só validação de entrada e montagem dos clientes.
 * As RPCs platform_* rodam com o JWT de quem pede (o banco decide); service_role só após a checagem.
 */
async function clients(context: { supabase: unknown; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const server = await import("@/lib/platform-organizations.server");
  return {
    user: context.supabase as SupabaseClient,
    admin: supabaseAdmin as unknown as SupabaseClient,
    callerId: context.userId,
    server,
  };
}

const logoSchema = z
  .object({
    base64: z.string().min(1).max(1_500_000),
    contentType: z.enum(LOGO_TYPES),
  })
  .nullable()
  .optional();

const redirectSchema = z.string().url().max(500);

const createSchema = z.object({
  form: organizationFormSchema,
  logo: logoSchema,
  firstAdmin: z
    .object({
      nome: firstAdminSchema.shape.nome,
      email: firstAdminSchema.shape.email,
      role: z.enum(["super_admin", "admin"]),
    })
    .nullable()
    .optional(),
  redirectTo: redirectSchema,
});

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  form: organizationFormSchema,
  logo: logoSchema,
});

const statusSchema = z.object({
  organizationId: z.string().uuid(),
  status: z.enum(["ativa", "suspensa"]),
});

const moduleSchema = z.object({
  organizationId: z.string().uuid(),
  module: z.enum(ORGANIZATION_MODULES),
  enabled: z.boolean(),
});

const inviteSchema = firstAdminSchema.extend({
  role: z.enum(["super_admin", "admin"]),
  redirectTo: redirectSchema,
});

// "Link do XML (portais)" (card t_76243950): só o administrador da plataforma lê, altera e testa.
const xmlOrgSchema = z.object({ organizationId: z.string().uuid() });
const xmlSalvarSchema = z.object({
  organizationId: z.string().uuid(),
  url: z.string().trim().max(500),
});
const xmlTestarSchema = z.object({ url: z.string().trim().min(1).max(500) });

export const getOrganizationXmlFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => xmlOrgSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, callerId } = await clients(context);
    const xml = await import("@/lib/xml-feed.server");
    return xml.lerLinkXml(admin, callerId, data.organizationId);
  });

export const saveOrganizationXmlFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => xmlSalvarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { user, admin, callerId } = await clients(context);
    const xml = await import("@/lib/xml-feed.server");
    return xml.salvarLinkXml(user, admin, callerId, data.organizationId, data.url);
  });

export const testOrganizationXmlFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => xmlTestarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, callerId } = await clients(context);
    const xml = await import("@/lib/xml-feed.server");
    return xml.testarLinkXml(admin, callerId, data.url);
  });

/** Só diz se quem pede é super-admin da plataforma (para mostrar o menu). Nunca lança. */
export const getPlatformAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { user } = await clients(context);
    const { data, error } = await user.rpc("is_platform_super_admin");
    return { isPlatformAdmin: !error && data === true };
  });

export const listPlatformOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, callerId, server } = await clients(context);
    return server.listOrganizations(admin, callerId);
  });

export const createPlatformOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { user, admin, callerId, server } = await clients(context);
    return server.createOrganizationFlow(user, admin, callerId, {
      form: data.form,
      logo: data.logo ?? null,
      firstAdmin: data.firstAdmin ?? null,
      redirectTo: data.redirectTo,
    });
  });

export const updatePlatformOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { user, admin, callerId, server } = await clients(context);
    return server.updateOrganizationFlow(user, admin, callerId, {
      organizationId: data.organizationId,
      form: data.form,
      logo: data.logo ?? null,
    });
  });

export const setPlatformOrganizationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => statusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { user, admin, callerId, server } = await clients(context);
    await server.setOrganizationStatus(user, admin, callerId, data.organizationId, data.status);
    return { ok: true };
  });

export const setPlatformOrganizationModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => moduleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { user, admin, callerId, server } = await clients(context);
    await server.setOrganizationModule(
      user,
      admin,
      callerId,
      data.organizationId,
      data.module,
      data.enabled,
    );
    return { ok: true };
  });

export const invitePlatformOrganizationAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, callerId, server } = await clients(context);
    return server.inviteOrganizationAdmin(admin, callerId, data);
  });
