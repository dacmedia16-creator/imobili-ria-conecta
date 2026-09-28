import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CheckCircle2, CircleSlash, Copy, Pencil, Plus, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  createPlatformOrganization,
  invitePlatformOrganizationAdmin,
  listPlatformOrganizations,
  setPlatformOrganizationStatus,
  updatePlatformOrganization,
} from "@/lib/platform-organizations.functions";
import {
  formatCnpj,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  organizationFormSchema,
  slugify,
  STEP_LABEL,
  type OrganizationSummary,
  type Step,
} from "@/lib/platform-organizations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Visibilidade da tela: só o super-admin da PLATAFORMA. O banco (RPCs platform_*) e o servidor
 * repetem a verificação antes de qualquer mudança. */
export async function guardPlatformRoute() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/auth" });
  const { data: ok, error } = await supabase.rpc("is_platform_super_admin");
  if (error || ok !== true) throw redirect({ to: "/dashboard" });
}

export const Route = createFileRoute("/_authenticated/plataforma/imobiliarias")({
  head: () => ({ meta: [{ title: "Imobiliárias — Plataforma" }] }),
  beforeLoad: guardPlatformRoute,
  component: PlatformOrganizations,
});

type Logo = { base64: string; contentType: (typeof LOGO_TYPES)[number]; preview: string };
type FormState = {
  nome: string;
  slug: string;
  slugTouched: boolean;
  cnpj: string;
  corPrimaria: string;
  corSecundaria: string;
  logo: Logo | null;
  adminNome: string;
  adminEmail: string;
  adminRole: "super_admin" | "admin";
};

const EMPTY: FormState = {
  nome: "",
  slug: "",
  slugTouched: false,
  cnpj: "",
  corPrimaria: "",
  corSecundaria: "",
  logo: null,
  adminNome: "",
  adminEmail: "",
  adminRole: "super_admin",
};

function fromOrg(o: OrganizationSummary): FormState {
  return {
    ...EMPTY,
    nome: o.nome,
    slug: o.slug,
    slugTouched: true,
    cnpj: formatCnpj(o.cnpj),
    corPrimaria: o.cor_primaria ?? "",
    corSecundaria: o.cor_secundaria ?? "",
  };
}

const redirectTo = () => `${window.location.origin}/redefinir-senha`;

async function readLogo(file: File): Promise<Logo> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type))
    throw new Error("Logo deve ser PNG, JPG ou WEBP.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("Logo acima de 1 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return {
    base64: btoa(bin),
    contentType: file.type as Logo["contentType"],
    preview: URL.createObjectURL(file),
  };
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2" aria-label="Status das etapas">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-sm">
          {s.status === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : s.status === "erro" ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span>
            <span className="font-medium">{STEP_LABEL[s.key]}</span>
            <span className="sr-only">
              {s.status === "ok" ? " concluída" : s.status === "erro" ? " com erro" : " não executada"}
            </span>
            : {s.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

function InviteBox({ link }: { link: string }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-sm">
        Link de primeiro acesso (válido por tempo limitado). <strong>Nenhum e-mail foi enviado</strong>:
        copie e entregue ao administrador; ele definirá a própria senha.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Link de convite" className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast.success("Link copiado");
          }}
        >
          <Copy className="mr-1 h-4 w-4" /> Copiar
        </Button>
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor)`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border"
        />
        <Input id={id} placeholder="#RRGGBB" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function PlatformOrganizations() {
  const listFn = useServerFn(listPlatformOrganizations);
  const createFn = useServerFn(createPlatformOrganization);
  const updateFn = useServerFn(updatePlatformOrganization);
  const statusFn = useServerFn(setPlatformOrganizationStatus);
  const inviteFn = useServerFn(invitePlatformOrganizationAdmin);

  const [orgs, setOrgs] = useState<OrganizationSummary[] | null>(null);
  // A demonstração mostra A/B sem apagar os registros E2E e seus logs de auditoria.
  const [showTestOrganizations, setShowTestOrganizations] = useState(false);
  const visibleOrgs = import.meta.env.VITE_HOMOLOG_ONLY === "true" && !showTestOrganizations
    ? orgs?.filter((o) => o.slug === "unica-escolha" || o.slug === "agencia-b-homolog")
    : orgs;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrganizationSummary | "new" | null>(null);
  const [inviting, setInviting] = useState<OrganizationSummary | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      setOrgs(await listFn());
    } catch (e) {
      setLoadError(errorMessage(e, "Não foi possível carregar as imobiliárias"));
    }
  }, [listFn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "nome" && !f.slugTouched ? { slug: slugify(String(v)) } : {}),
      ...(k === "slug" ? { slugTouched: true } : {}),
    }));

  const openNew = () => {
    setForm(EMPTY);
    setSteps(null);
    setLink(null);
    setFieldError(null);
    setEditing("new");
  };
  const openEdit = (o: OrganizationSummary) => {
    setForm(fromOrg(o));
    setSteps(null);
    setLink(null);
    setFieldError(null);
    setEditing(o);
  };
  const openInvite = (o: OrganizationSummary) => {
    setForm({ ...EMPTY, adminRole: o.administradores > 0 ? "admin" : "super_admin" });
    setSteps(null);
    setLink(null);
    setFieldError(null);
    setInviting(o);
  };

  const submitOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = organizationFormSchema.safeParse(form);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Dados inválidos.");
      return;
    }
    const wantsAdmin = editing === "new" && (form.adminNome.trim() || form.adminEmail.trim());
    if (wantsAdmin && !(form.adminNome.trim() && form.adminEmail.trim())) {
      setFieldError("Para convidar o administrador, informe nome completo e e-mail.");
      return;
    }
    setFieldError(null);
    setSaving(true);
    setSteps(null);
    setLink(null);
    const logo = form.logo ? { base64: form.logo.base64, contentType: form.logo.contentType } : null;
    try {
      if (editing === "new") {
        const r = await createFn({
          data: {
            form: parsed.data,
            logo,
            firstAdmin: wantsAdmin
              ? { nome: form.adminNome, email: form.adminEmail, role: form.adminRole }
              : null,
            redirectTo: redirectTo(),
          },
        });
        setSteps(r.steps);
        setLink(r.inviteLink);
        if (r.organizationId) toast.success("Imobiliária cadastrada");
      } else if (editing) {
        const r = await updateFn({ data: { organizationId: editing.id, form: parsed.data, logo } });
        setSteps(r.steps);
        if (r.steps.every((s) => s.status !== "erro")) toast.success("Imobiliária atualizada");
      }
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível salvar"));
    } finally {
      setSaving(false);
    }
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviting) return;
    setSaving(true);
    setSteps(null);
    setLink(null);
    try {
      const r = await inviteFn({
        data: {
          organizationId: inviting.id,
          nome: form.adminNome,
          email: form.adminEmail,
          role: form.adminRole,
          redirectTo: redirectTo(),
        },
      });
      setSteps(r.steps);
      setLink(r.inviteLink);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível gerar o convite"));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (o: OrganizationSummary) => {
    const next = o.status === "ativa" ? "suspensa" : "ativa";
    if (next === "suspensa" && !window.confirm(`Suspender ${o.nome}? Os usuários perdem o acesso.`)) return;
    try {
      await statusFn({ data: { organizationId: o.id, status: next } });
      toast.success(next === "ativa" ? "Imobiliária reativada" : "Imobiliária suspensa");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível alterar o status"));
    }
  };

  const closeDialogs = () => {
    if (form.logo) URL.revokeObjectURL(form.logo.preview);
    setEditing(null);
    setInviting(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Plataforma → Imobiliárias</h1>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> Nova imobiliária
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Área exclusiva do super-admin da plataforma. Gestores e administradores das imobiliárias não
        veem esta tela.
      </p>
      {import.meta.env.VITE_HOMOLOG_ONLY === "true" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <span>Exibição de demonstração: somente agências fictícias A e B. Registros E2E preservados.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowTestOrganizations((v) => !v)}>
            {showTestOrganizations ? "Ocultar registros de teste" : "Ver registros de teste"}
          </Button>
        </div>
      )}

      {loadError && (
        <Card>
          <CardContent className="flex items-center justify-between gap-2 pt-6">
            <p role="alert" className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" onClick={() => void reload()}>Tentar novamente</Button>
          </CardContent>
        </Card>
      )}
      {!orgs && !loadError && <p>Carregando imobiliárias…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(visibleOrgs ?? []).map((o) => (
          <Card key={o.id} className={o.status === "suspensa" ? "opacity-70" : ""}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border"
                  style={{ background: o.cor_primaria ?? undefined }}
                >
                  {o.logoUrl ? (
                    <img src={o.logoUrl} alt={`Logo ${o.nome}`} className="h-full w-full object-contain" />
                  ) : (
                    <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div>
                  <CardTitle className="text-base">{o.nome}</CardTitle>
                  <p className="text-xs text-muted-foreground">{o.slug}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge variant={o.status === "ativa" ? "default" : "destructive"}>
                  {o.status === "ativa" ? "Ativa" : "Suspensa"}
                </Badge>
                {o.legacy_default && <Badge variant="outline">Agência original</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-2 gap-1 text-sm">
                <dt className="text-muted-foreground">CNPJ</dt>
                <dd>{o.cnpj ? formatCnpj(o.cnpj) : "—"}</dd>
                <dt className="text-muted-foreground">Usuários ativos</dt>
                <dd>{o.membros}</dd>
                <dt className="text-muted-foreground">Administradores</dt>
                <dd>{o.administradores === 0 ? "Nenhum — convide o primeiro" : o.administradores}</dd>
                <dt className="text-muted-foreground">Cores</dt>
                <dd className="flex gap-1">
                  {[o.cor_primaria, o.cor_secundaria].filter(Boolean).map((c) => (
                    <span key={c} title={c ?? ""} className="h-4 w-4 rounded border" style={{ background: c ?? undefined }} />
                  ))}
                  {!o.cor_primaria && !o.cor_secundaria && "—"}
                </dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(o)}>
                  <Pencil className="mr-1 h-4 w-4" /> Editar
                </Button>
                <Button size="sm" variant="outline" disabled={o.status !== "ativa"} onClick={() => openInvite(o)}>
                  <UserPlus className="mr-1 h-4 w-4" /> Convidar administrador
                </Button>
                {!o.legacy_default && (
                  <Button size="sm" variant={o.status === "ativa" ? "destructive" : "default"} onClick={() => void toggleStatus(o)}>
                    {o.status === "ativa" ? "Suspender" : "Reativar"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nova imobiliária" : "Editar imobiliária"}</DialogTitle>
            <DialogDescription>
              Nome, identificador, CNPJ, cores e logo.{" "}
              {editing === "new" && "Opcional: convide o primeiro administrador por link."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitOrg} noValidate>
            <div className="space-y-1">
              <Label htmlFor="org-nome">Nome da imobiliária</Label>
              <Input id="org-nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-slug">Identificador</Label>
              <Input id="org-slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} required />
              <p className="text-xs text-muted-foreground">Letras minúsculas, números e hífen.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-cnpj">CNPJ</Label>
              <Input id="org-cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorField id="org-cor1" label="Cor principal" value={form.corPrimaria} onChange={(v) => set("corPrimaria", v)} />
              <ColorField id="org-cor2" label="Cor secundária" value={form.corSecundaria} onChange={(v) => set("corSecundaria", v)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-logo">Logo (PNG, JPG ou WEBP, até 1 MB)</Label>
              <Input
                id="org-logo"
                type="file"
                accept={LOGO_TYPES.join(",")}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return set("logo", null);
                  try {
                    set("logo", await readLogo(file));
                  } catch (err) {
                    e.target.value = "";
                    toast.error(errorMessage(err, "Logo inválido"));
                  }
                }}
              />
              {(form.logo || (editing !== "new" && editing?.logoUrl)) && (
                <img
                  src={form.logo?.preview ?? (editing !== "new" ? editing?.logoUrl ?? "" : "")}
                  alt="Pré-visualização do logo"
                  className="mt-2 h-16 w-auto rounded border object-contain"
                />
              )}
            </div>
            {editing === "new" && (
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Primeiro administrador (convite)</legend>
                <div className="space-y-1">
                  <Label htmlFor="adm-nome">Nome completo</Label>
                  <Input id="adm-nome" value={form.adminNome} onChange={(e) => set("adminNome", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adm-email">E-mail</Label>
                  <Input id="adm-email" type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} />
                </div>
                <RoleSelect value={form.adminRole} onChange={(v) => set("adminRole", v)} />
              </fieldset>
            )}
            {fieldError && <p role="alert" className="text-sm text-destructive">{fieldError}</p>}
            {steps && <StepList steps={steps} />}
            {link && <InviteBox link={link} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialogs}>
                {steps ? "Fechar" : "Cancelar"}
              </Button>
              {!(editing === "new" && steps?.some((s) => s.key === "organizacao" && s.status === "ok")) && (
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando…" : editing === "new" ? "Cadastrar" : "Salvar"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={inviting !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Convidar administrador — {inviting?.nome}</DialogTitle>
            <DialogDescription>
              O usuário nasce nesta imobiliária. Se o e-mail já for desta imobiliária, só um novo link é
              gerado. Nenhum e-mail é enviado.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitInvite}>
            <div className="space-y-1">
              <Label htmlFor="inv-nome">Nome completo</Label>
              <Input id="inv-nome" value={form.adminNome} onChange={(e) => set("adminNome", e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-email">E-mail</Label>
              <Input id="inv-email" type="email" value={form.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} required />
            </div>
            <RoleSelect value={form.adminRole} onChange={(v) => set("adminRole", v)} />
            {steps && <StepList steps={steps} />}
            {link && <InviteBox link={link} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialogs}>
                {steps ? "Fechar" : "Cancelar"}
              </Button>
              {!link && (
                <Button type="submit" disabled={saving}>
                  {saving ? "Gerando…" : "Gerar convite"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: "super_admin" | "admin";
  onChange: (v: "super_admin" | "admin") => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor="adm-role">Papel na imobiliária</Label>
      <Select value={value} onValueChange={(v) => onChange(v as "super_admin" | "admin")}>
        <SelectTrigger id="adm-role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="super_admin">Super Admin da imobiliária (pode criar administradores)</SelectItem>
          <SelectItem value="admin">Administrador</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
