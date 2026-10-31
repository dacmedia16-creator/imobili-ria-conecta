import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleSlash,
  Copy,
  LogIn,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Puzzle,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { enterOrganization, takeContextExpiredFlag } from "@/lib/platform-context";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  createPlatformOrganization,
  invitePlatformOrganizationAdmin,
  listPlatformOrganizations,
  setPlatformOrganizationModule,
  setPlatformOrganizationStatus,
  updatePlatformOrganization,
} from "@/lib/platform-organizations.functions";
import { Switch } from "@/components/ui/switch";
import { OrgInvitesPanel } from "@/components/platform/OrgInvitesPanel";
import { XmlFeedField } from "@/components/platform/XmlFeedField";
import {
  formatCnpj,
  ORGANIZATION_MODULE_LABELS,
  ORGANIZATION_MODULES,
  type OrganizationModule,
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
  head: () => ({ meta: [{ title: "Painel da Plataforma" }] }),
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

// Convite só com Google (t_93e80346): o link é a entrada pelo Google (Conta MAX), não "definir senha".
const redirectTo = () =>
  import.meta.env.VITE_HOMOLOG_ONLY === "true"
    ? "https://conta.somosmaxhub.com.br/login?app=adm-max-homolog"
    : "https://conta.somosmaxhub.com.br/login?app=adm-max";

async function readLogo(file: File): Promise<Logo> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type))
    throw new Error("Logo deve ser PNG, JPG ou WEBP.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("Logo acima de 1 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
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
              {s.status === "ok"
                ? " concluída"
                : s.status === "erro"
                  ? " com erro"
                  : " não executada"}
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
        Link de primeiro acesso. <strong>Nenhum e-mail foi enviado</strong>: copie e entregue ao
        administrador. Ele entra pelo botão &quot;Entrar com Google&quot;, usando a conta Google do
        e-mail cadastrado (não existe senha).
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
        <Input
          id={id}
          placeholder="#RRGGBB"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// ---------- Peças visuais (t_ad2f0259; inspiração 21st.dev: KPI cards + lista com busca/filtro) ----------

type KpiTone = "blue" | "green" | "amber" | "red";
const KPI_TONE: Record<KpiTone, string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: KpiTone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</dd>
        </div>
        <span className={cn("rounded-lg p-2", KPI_TONE[tone])} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StatusPill({ status }: { status: OrganizationSummary["status"] }) {
  const ativa = status === "ativa";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        ativa
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", ativa ? "bg-emerald-500" : "bg-rose-500")}
        aria-hidden
      />
      {ativa ? "Ativa" : "Suspensa"}
    </span>
  );
}

function OrgCardSkeleton() {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-9 w-2/3" />
    </div>
  );
}

type StatusFilter = "todas" | "ativa" | "suspensa";

function PlatformOrganizations() {
  const listFn = useServerFn(listPlatformOrganizations);
  const createFn = useServerFn(createPlatformOrganization);
  const updateFn = useServerFn(updatePlatformOrganization);
  const statusFn = useServerFn(setPlatformOrganizationStatus);
  const moduleFn = useServerFn(setPlatformOrganizationModule);
  const [savingModule, setSavingModule] = useState<string | null>(null);
  const inviteFn = useServerFn(invitePlatformOrganizationAdmin);

  const [orgs, setOrgs] = useState<OrganizationSummary[] | null>(null);
  // A demonstração mostra A/B sem apagar os registros E2E e seus logs de auditoria.
  const [showTestOrganizations, setShowTestOrganizations] = useState(false);
  const visibleOrgs =
    import.meta.env.VITE_HOMOLOG_ONLY === "true" && !showTestOrganizations
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

  const { platformContext } = useAuth();
  const [entering, setEntering] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);
  useEffect(() => {
    const name = takeContextExpiredFlag();
    if (name !== null) setExpiredNotice(name);
  }, []);

  // Entrar → RPC de entrada (o banco valida platform_admins, sessão de login e status da org) →
  // recarrega o app inteiro já no contexto, para nenhum dado de outra imobiliária ficar em cache.
  const enterOrg = async (o: OrganizationSummary) => {
    setEntering(o.id);
    try {
      await enterOrganization(o.id);
      window.location.assign("/dashboard");
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível entrar na imobiliária"));
      setEntering(null);
    }
  };

  const totals = (visibleOrgs ?? []).reduce(
    (acc, o) => ({
      ativas: acc.ativas + (o.status === "ativa" ? 1 : 0),
      suspensas: acc.suspensas + (o.status === "ativa" ? 0 : 1),
      membros: acc.membros + o.membros,
      semAdmin: acc.semAdmin + (o.administradores === 0 ? 1 : 0),
    }),
    { ativas: 0, suspensas: 0, membros: 0, semAdmin: 0 },
  );

  // Busca e filtro são só de exibição: a lista carregada do servidor não muda.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todas");
  const filteredOrgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return (visibleOrgs ?? []).filter(
      (o) =>
        (statusFilter === "todas" || o.status === statusFilter) &&
        (!q ||
          o.nome.toLowerCase().includes(q) ||
          o.slug.toLowerCase().includes(q) ||
          (digits.length > 0 && (o.cnpj ?? "").includes(digits))),
    );
  }, [visibleOrgs, query, statusFilter]);

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
    const logo = form.logo
      ? { base64: form.logo.base64, contentType: form.logo.contentType }
      : null;
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
    if (next === "suspensa" && !window.confirm(`Suspender ${o.nome}? Os usuários perdem o acesso.`))
      return;
    try {
      await statusFn({ data: { organizationId: o.id, status: next } });
      toast.success(next === "ativa" ? "Imobiliária reativada" : "Imobiliária suspensa");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível alterar o status"));
    }
  };

  const toggleModule = async (o: OrganizationSummary, m: OrganizationModule, enabled: boolean) => {
    const label = ORGANIZATION_MODULE_LABELS[m];
    if (!enabled && !window.confirm(`Desligar ${label} em ${o.nome}? Os dados ficam guardados.`))
      return;
    setSavingModule(`${o.id}:${m}`);
    try {
      await moduleFn({ data: { organizationId: o.id, module: m, enabled } });
      toast.success(`${label} ${enabled ? "ligado" : "desligado"} em ${o.nome}`);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Não foi possível alterar o módulo"));
    } finally {
      setSavingModule(null);
    }
  };

  const closeDialogs = () => {
    if (form.logo) URL.revokeObjectURL(form.logo.preview);
    setEditing(null);
    setInviting(null);
  };

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="rounded-xl bg-primary p-2.5 text-primary-foreground shadow-sm"
              aria-hidden
            >
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Painel da Plataforma</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Aqui você cuida de todas as imobiliárias: cadastra, liga módulos, convida
                administradores e entra em cada uma. Só o super-admin da plataforma vê esta tela.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="outline" asChild className="flex-1 sm:flex-none">
              <Link to="/plataforma/usuarios">
                <Users className="mr-1 h-4 w-4" /> Usuários de todas as imobiliárias
              </Link>
            </Button>
            <Button onClick={openNew} className="flex-1 sm:flex-none">
              <Plus className="mr-1 h-4 w-4" /> Nova imobiliária
            </Button>
          </div>
        </div>
      </header>

      {import.meta.env.VITE_HOMOLOG_ONLY === "true" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-muted/30 p-3 text-sm">
          <span>
            Exibição de demonstração: somente agências fictícias A e B. Registros E2E preservados.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowTestOrganizations((v) => !v)}
          >
            {showTestOrganizations ? "Ocultar registros de teste" : "Ver registros de teste"}
          </Button>
        </div>
      )}

      {expiredNotice !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Seu acesso à {expiredNotice || "imobiliária"} expirou (limite de 8 horas). Você voltou
            ao Painel da Plataforma; entre de novo se precisar.
          </span>
          <Button size="sm" variant="outline" onClick={() => setExpiredNotice(null)}>
            Entendi
          </Button>
        </div>
      )}
      {platformContext && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Você está dentro da {platformContext.organizationName}. Entrar em outra imobiliária
            encerra esse acesso; para só voltar à plataforma, use “Sair” na faixa amarela.
          </span>
        </div>
      )}

      {orgs ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Totais da plataforma">
          <KpiCard
            label="Imobiliárias ativas"
            value={totals.ativas}
            hint="Funcionando normalmente"
            icon={CheckCircle2}
            tone="green"
          />
          <KpiCard
            label="Suspensas"
            value={totals.suspensas}
            hint={totals.suspensas ? "Usuários sem acesso" : "Nenhuma bloqueada"}
            icon={Pause}
            tone="red"
          />
          <KpiCard
            label="Usuários ativos"
            value={totals.membros}
            hint="Somando todas as imobiliárias"
            icon={Users}
            tone="blue"
          />
          <KpiCard
            label="Sem administrador"
            value={totals.semAdmin}
            hint={totals.semAdmin ? "Convide o primeiro administrador" : "Todas têm responsável"}
            icon={ShieldCheck}
            tone="amber"
          />
        </dl>
      ) : (
        !loadError && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[108px] rounded-xl" />
            ))}
          </div>
        )
      )}

      <OrgInvitesPanel />

      {orgs && (orgs.length > 0 || query) && (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome, identificador ou CNPJ"
              aria-label="Buscar imobiliária"
              className="pl-9"
            />
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={statusFilter}
              onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}
              aria-label="Filtrar por situação"
            >
              <ToggleGroupItem value="todas">Todas</ToggleGroupItem>
              <ToggleGroupItem value="ativa">Ativas</ToggleGroupItem>
              <ToggleGroupItem value="suspensa">Suspensas</ToggleGroupItem>
            </ToggleGroup>
            <span className="whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">
              {filteredOrgs.length} de {visibleOrgs?.length ?? 0}
            </span>
          </div>
        </div>
      )}

      {loadError && (
        <Card className="rounded-xl border-destructive/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
            <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" aria-hidden />
              {loadError}
            </p>
            <Button variant="outline" onClick={() => void reload()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
      {!orgs && !loadError && (
        <div className="grid gap-4 md:grid-cols-2" role="status">
          <span className="sr-only">Carregando imobiliárias…</span>
          <OrgCardSkeleton />
          <OrgCardSkeleton />
        </div>
      )}

      {orgs && filteredOrgs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <span className="rounded-full bg-muted p-3" aria-hidden>
            <Building2 className="h-6 w-6 text-muted-foreground" />
          </span>
          {(visibleOrgs?.length ?? 0) === 0 ? (
            <>
              <p className="font-medium">Nenhuma imobiliária cadastrada ainda</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Cadastre a primeira imobiliária e, se quiser, já convide o administrador dela.
              </p>
              <Button onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" /> Nova imobiliária
              </Button>
            </>
          ) : (
            <>
              <p className="font-medium">Nenhuma imobiliária encontrada</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Nada combina com a busca ou o filtro escolhido.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("todas");
                }}
              >
                Limpar busca e filtro
              </Button>
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {filteredOrgs.map((o) => {
          const ativa = o.status === "ativa";
          const aqui = platformContext?.organizationId === o.id;
          const modulosLigados = ORGANIZATION_MODULES.filter((m) => o.modulos[m]).length;
          return (
            <div
              key={o.id}
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                !ativa && "border-rose-500/30",
                aqui && "ring-2 ring-amber-400",
              )}
            >
              <div
                className="h-1.5 w-full"
                style={{
                  background:
                    o.cor_primaria || o.cor_secundaria
                      ? `linear-gradient(90deg, ${o.cor_primaria ?? o.cor_secundaria}, ${o.cor_secundaria ?? o.cor_primaria})`
                      : "var(--muted)",
                }}
                aria-hidden
              />
              <div className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm",
                        !ativa && "grayscale",
                      )}
                      style={{ background: o.cor_primaria ?? undefined }}
                    >
                      {o.logoUrl ? (
                        <img
                          src={o.logoUrl}
                          alt={`Logo ${o.nome}`}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Building2
                          className={cn(
                            "h-6 w-6",
                            o.cor_primaria ? "text-white/90" : "text-muted-foreground",
                          )}
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="line-clamp-2 break-words text-base font-semibold leading-tight">
                        {o.nome}
                      </h2>
                      <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                        {o.slug}
                        {[o.cor_primaria, o.cor_secundaria].filter(Boolean).map((c) => (
                          <span
                            key={c}
                            title={`Cor ${c ?? ""}`}
                            className="inline-block h-3 w-3 rounded-full border"
                            style={{ background: c ?? undefined }}
                          />
                        ))}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusPill status={o.status} />
                    {o.legacy_default && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        Agência original
                      </Badge>
                    )}
                  </div>
                </div>

                {!ativa && (
                  <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    Suspensa: os usuários desta imobiliária estão sem acesso. Use “Reativar” para
                    liberar.
                  </p>
                )}

                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">Usuários ativos</dt>
                    <dd className="text-lg font-semibold tabular-nums">{o.membros}</dd>
                  </div>
                  <div
                    className={cn(
                      "rounded-lg px-2 py-2",
                      o.administradores === 0
                        ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                        : "bg-muted/50",
                    )}
                  >
                    <dt className="text-[11px] text-muted-foreground">Administradores</dt>
                    <dd className="text-lg font-semibold tabular-nums">{o.administradores}</dd>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">CNPJ</dt>
                    <dd className="truncate pt-1 text-xs font-medium">
                      {o.cnpj ? formatCnpj(o.cnpj) : "Não informado"}
                    </dd>
                  </div>
                </dl>
                {o.administradores === 0 && (
                  <p className="-mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    Nenhum administrador — convide o primeiro.
                  </p>
                )}

                <div className="rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Puzzle className="h-3.5 w-3.5" aria-hidden />
                      Módulos (só você liga ou desliga)
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {modulosLigados} de {ORGANIZATION_MODULES.length} ligados
                    </span>
                  </div>
                  <ul className="divide-y">
                    {ORGANIZATION_MODULES.map((m) => {
                      const id = `mod-${o.id}-${m}`;
                      const on = o.modulos[m];
                      return (
                        <li
                          key={m}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <label htmlFor={id} className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                on ? "bg-emerald-500" : "bg-muted-foreground/30",
                              )}
                              aria-hidden
                            />
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="break-words">{ORGANIZATION_MODULE_LABELS[m]}</span>
                              <span
                                className={cn(
                                  "text-xs",
                                  on
                                    ? "text-emerald-700 dark:text-emerald-400"
                                    : "text-muted-foreground",
                                )}
                              >
                                {on ? "Ligado" : "Desligado"}
                              </span>
                            </span>
                          </label>
                          <Switch
                            id={id}
                            checked={on}
                            disabled={savingModule !== null}
                            onCheckedChange={(v) => void toggleModule(o, m, v)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={!ativa || entering !== null}
                    onClick={() => void enterOrg(o)}
                    title={!ativa ? "Imobiliária suspensa" : undefined}
                  >
                    <LogIn className="mr-1 h-4 w-4" />
                    {entering === o.id
                      ? "Entrando…"
                      : aqui
                        ? "Você está aqui — reentrar"
                        : "Entrar como administrador"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(o)}>
                    <Pencil className="mr-1 h-4 w-4" /> Editar
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label={`Mais ações para ${o.nome}`}>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="ml-1 sm:hidden">Mais</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="truncate">{o.nome}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={!ativa} onSelect={() => openInvite(o)}>
                        <UserPlus className="mr-2 h-4 w-4" /> Convidar administrador
                      </DropdownMenuItem>
                      {!o.legacy_default && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => void toggleStatus(o)}
                            className={
                              ativa
                                ? "text-destructive focus:bg-destructive/10 focus:text-destructive"
                                : "text-emerald-700 focus:text-emerald-700 dark:text-emerald-400"
                            }
                          >
                            {ativa ? (
                              <Pause className="mr-2 h-4 w-4" />
                            ) : (
                              <Play className="mr-2 h-4 w-4" />
                            )}
                            {ativa ? "Suspender" : "Reativar"}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Nova imobiliária" : "Editar imobiliária"}
            </DialogTitle>
            <DialogDescription>
              Nome, identificador, CNPJ, cores e logo.{" "}
              {editing === "new" && "Opcional: convide o primeiro administrador por link."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitOrg} noValidate>
            <div className="space-y-1">
              <Label htmlFor="org-nome">Nome da imobiliária</Label>
              <Input
                id="org-nome"
                value={form.nome}
                onChange={(e) => set("nome", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-slug">Identificador</Label>
              <Input
                id="org-slug"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">Letras minúsculas, números e hífen.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-cnpj">CNPJ</Label>
              <Input
                id="org-cnpj"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => set("cnpj", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorField
                id="org-cor1"
                label="Cor principal"
                value={form.corPrimaria}
                onChange={(v) => set("corPrimaria", v)}
              />
              <ColorField
                id="org-cor2"
                label="Cor secundária"
                value={form.corSecundaria}
                onChange={(v) => set("corSecundaria", v)}
              />
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
                  src={form.logo?.preview ?? (editing !== "new" ? (editing?.logoUrl ?? "") : "")}
                  alt="Pré-visualização do logo"
                  className="mt-2 h-16 w-auto rounded border object-contain"
                />
              )}
            </div>
            {editing !== null && editing !== "new" && <XmlFeedField organizationId={editing.id} />}
            {editing === "new" && (
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  Primeiro administrador (convite)
                </legend>
                <div className="space-y-1">
                  <Label htmlFor="adm-nome">Nome completo</Label>
                  <Input
                    id="adm-nome"
                    value={form.adminNome}
                    onChange={(e) => set("adminNome", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adm-email">E-mail</Label>
                  <Input
                    id="adm-email"
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => set("adminEmail", e.target.value)}
                  />
                </div>
                <RoleSelect value={form.adminRole} onChange={(v) => set("adminRole", v)} />
              </fieldset>
            )}
            {fieldError && (
              <p role="alert" className="text-sm text-destructive">
                {fieldError}
              </p>
            )}
            {steps && <StepList steps={steps} />}
            {link && <InviteBox link={link} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialogs}>
                {steps ? "Fechar" : "Cancelar"}
              </Button>
              {!(
                editing === "new" &&
                steps?.some((s) => s.key === "organizacao" && s.status === "ok")
              ) && (
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
              O usuário nasce nesta imobiliária. Se o e-mail já for desta imobiliária, só um novo
              link é gerado. Nenhum e-mail é enviado.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitInvite}>
            <div className="space-y-1">
              <Label htmlFor="inv-nome">Nome completo</Label>
              <Input
                id="inv-nome"
                value={form.adminNome}
                onChange={(e) => set("adminNome", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-email">E-mail</Label>
              <Input
                id="inv-email"
                type="email"
                value={form.adminEmail}
                onChange={(e) => set("adminEmail", e.target.value)}
                required
              />
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
          <SelectItem value="super_admin">
            Administrador principal (pode criar administradores)
          </SelectItem>
          <SelectItem value="admin">Administrador</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
