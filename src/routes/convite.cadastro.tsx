import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  MaxHubAuthShell,
  MaxHubEyebrow,
  MaxHubMark,
  maxHubPrimaryButton,
} from "@/components/MaxHubAuthShell";
import {
  INVITE_CLAIM_STORAGE,
  inviteErrorMessage,
  selfSignupSchema,
  type SelfSignupForm,
} from "@/lib/org-invites";
import { acceptOrgInvite, readOrgInviteClaim } from "@/lib/org-invites.functions";
import { LOGO_MAX_BYTES, LOGO_TYPES } from "@/lib/platform-organizations";
import { contaMaxLoginUrl } from "@/lib/dominios";
import { errorMessage } from "@/lib/errors";

// Cadastro do dono pelo convite (t_6e4dab96). Só abre com a reserva de 1 h que a ponte Conta MAX
// entrega depois de conferir que o e-mail Google é o convidado. O servidor confere tudo de novo.
export const Route = createFileRoute("/convite/cadastro")({
  ssr: false,
  validateSearch: (raw: Record<string, unknown>): { erro?: string } =>
    typeof raw.erro === "string" && /^[a-z_]{3,40}$/.test(raw.erro) ? { erro: raw.erro } : {},
  head: () => ({ meta: [{ title: "Cadastro da imobiliária — ADM MAX" }] }),
  component: CadastroPage,
});

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

type Logo = { base64: string; contentType: (typeof LOGO_TYPES)[number]; name: string };
const EMPTY: SelfSignupForm = {
  nome: "",
  razaoSocial: "",
  cnpj: "",
  creci: "",
  cidade: "",
  uf: "",
  corPrimaria: "",
  corSecundaria: "",
  donoNome: "",
  donoTelefone: "",
};

const input =
  "mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-[#e3c682] focus:outline-none";
const label = "block text-sm font-medium text-white/90";

async function readLogo(file: File): Promise<Logo> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type))
    throw new Error("Logo deve ser PNG, JPG ou WEBP.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("Logo acima de 1 MB.");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), contentType: file.type as Logo["contentType"], name: file.name };
}

function Card({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <section
      aria-labelledby="cad-titulo"
      className="mx-auto w-full max-w-2xl rounded-3xl border border-white/10 bg-[#071325]/70 p-6 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] backdrop-blur-sm sm:p-9"
    >
      <div className="flex items-center gap-3">
        <MaxHubMark className="h-10 w-10" />
        <MaxHubEyebrow>Convite · ADM MAX</MaxHubEyebrow>
      </div>
      <h1 id="cad-titulo" className="mt-6 font-maxhub-display text-2xl font-bold">
        {titulo}
      </h1>
      {children}
    </section>
  );
}

function CadastroPage() {
  const { erro } = Route.useSearch();
  const readFn = useServerFn(readOrgInviteClaim);
  const acceptFn = useServerFn(acceptOrgInvite);
  const [claim, setClaim] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(
    erro ? inviteErrorMessage(erro, "Não foi possível validar o convite.") : null,
  );
  const [form, setForm] = useState<SelfSignupForm>(EMPTY);
  const [logo, setLogo] = useState<Logo | null>(null);
  const [campoErro, setCampoErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState<{ nome: string } | null>(null);

  useEffect(() => {
    if (erro) return;
    const c = window.sessionStorage.getItem(INVITE_CLAIM_STORAGE);
    if (!c) {
      setFalha("Abra o link do convite que chegou no seu e-mail para começar o cadastro.");
      return;
    }
    setClaim(c);
    readFn({ data: { claim: c } })
      .then((r) => setEmail(r.email))
      .catch((e) => setFalha(errorMessage(e, "Não foi possível abrir o cadastro.")));
  }, [erro, readFn]);

  const set = <K extends keyof SelfSignupForm>(k: K, v: SelfSignupForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = selfSignupSchema.safeParse(form);
    if (!parsed.success) {
      setCampoErro(parsed.error.issues[0]?.message ?? "Confira os dados.");
      return;
    }
    if (!claim) return;
    setCampoErro(null);
    setSalvando(true);
    try {
      const r = await acceptFn({
        data: {
          claim,
          form: parsed.data,
          logo: logo ? { base64: logo.base64, contentType: logo.contentType } : null,
        },
      });
      window.sessionStorage.removeItem(INVITE_CLAIM_STORAGE);
      setPronto({ nome: r.organizationName });
    } catch (err) {
      setCampoErro(errorMessage(err, "Não foi possível concluir o cadastro."));
    } finally {
      setSalvando(false);
    }
  };

  const entrar = contaMaxLoginUrl(IS_HOMOLOG ? "adm-max-homolog" : "adm-max");
  const footer = IS_HOMOLOG ? "ADM MAX · Ambiente de homologação" : "ADM MAX";

  if (pronto) {
    return (
      <MaxHubAuthShell footer={footer}>
        <Card titulo="Cadastro concluído!">
          <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-white/85">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            A {pronto.nome} já está ativa no ADM MAX e você é o administrador. Entre com a mesma
            conta Google para começar.
          </p>
          <a href={entrar} className={`${maxHubPrimaryButton} mt-7 w-full`}>
            Entrar no ADM MAX <ArrowRight size={18} aria-hidden="true" />
          </a>
        </Card>
      </MaxHubAuthShell>
    );
  }

  if (falha) {
    return (
      <MaxHubAuthShell footer={footer}>
        <Card titulo="Não foi possível usar este convite">
          <p role="alert" className="mt-3 text-sm leading-relaxed text-white/85">
            {falha}
          </p>
          <p className="mt-4 text-xs text-[#a9b8cf]">
            Se você entrou com a conta Google errada, abra de novo o link do e-mail e escolha a
            conta certa.
          </p>
        </Card>
      </MaxHubAuthShell>
    );
  }

  if (!email) {
    return (
      <MaxHubAuthShell footer={footer}>
        <Card titulo="Carregando seu convite…">
          <p role="status" className="mt-3 text-sm text-white/75">
            Só um instante.
          </p>
        </Card>
      </MaxHubAuthShell>
    );
  }

  return (
    <MaxHubAuthShell footer={footer}>
      <Card titulo="Cadastre sua imobiliária">
        <p className="mt-2 text-sm text-white/75">
          Conta confirmada: <strong className="break-all text-white">{email}</strong>. Preencha os
          dados abaixo. Ao concluir, a imobiliária fica ativa e você vira o administrador.
        </p>
        <form onSubmit={enviar} className="mt-6 space-y-6" noValidate>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#e3c682]">
              Imobiliária
            </legend>
            <label className={`${label} sm:col-span-2`}>
              Nome da imobiliária *
              <input
                className={input}
                value={form.nome}
                onChange={(e) => set("nome", e.target.value)}
                autoComplete="organization"
                required
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              Razão social
              <input
                className={input}
                value={form.razaoSocial ?? ""}
                onChange={(e) => set("razaoSocial", e.target.value)}
              />
            </label>
            <label className={label}>
              CNPJ *
              <input
                className={input}
                value={form.cnpj}
                onChange={(e) => set("cnpj", e.target.value)}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                required
              />
            </label>
            <label className={label}>
              CRECI da imobiliária
              <input
                className={input}
                value={form.creci ?? ""}
                onChange={(e) => set("creci", e.target.value)}
              />
            </label>
            <label className={label}>
              Cidade *
              <input
                className={input}
                value={form.cidade}
                onChange={(e) => set("cidade", e.target.value)}
                autoComplete="address-level2"
                required
              />
            </label>
            <label className={label}>
              UF *
              <select
                className={input}
                value={form.uf}
                onChange={(e) => set("uf", e.target.value)}
                required
              >
                <option value="" className="text-black">
                  Selecione
                </option>
                {UFS.map((u) => (
                  <option key={u} value={u} className="text-black">
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Cor principal
              <input
                className={`${input} h-11 p-1`}
                type="color"
                value={form.corPrimaria || "#0d1f3b"}
                onChange={(e) => set("corPrimaria", e.target.value)}
              />
            </label>
            <label className={label}>
              Cor secundária
              <input
                className={`${input} h-11 p-1`}
                type="color"
                value={form.corSecundaria || "#dc1c2e"}
                onChange={(e) => set("corSecundaria", e.target.value)}
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              Logo (PNG, JPG ou WEBP, até 1 MB)
              <input
                className={`${input} file:mr-3 file:rounded-full file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-white`}
                type="file"
                accept={LOGO_TYPES.join(",")}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return setLogo(null);
                  try {
                    setLogo(await readLogo(f));
                    setCampoErro(null);
                  } catch (err) {
                    setLogo(null);
                    setCampoErro(errorMessage(err, "Logo inválido."));
                  }
                }}
              />
            </label>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#e3c682]">
              Seus dados (administrador)
            </legend>
            <label className={label}>
              Seu nome completo *
              <input
                className={input}
                value={form.donoNome}
                onChange={(e) => set("donoNome", e.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label className={label}>
              Telefone (WhatsApp) *
              <input
                className={input}
                value={form.donoTelefone}
                onChange={(e) => set("donoTelefone", e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(15) 99999-9999"
                required
              />
            </label>
            <p className="text-xs text-[#a9b8cf] sm:col-span-2">
              E-mail de acesso: {email} (entrada só pelo botão Entrar com Google, sem senha).
            </p>
          </fieldset>

          {campoErro && (
            <p role="alert" className="rounded-xl bg-[#dc1c2e]/15 px-4 py-3 text-sm text-white">
              {campoErro}
            </p>
          )}
          <button type="submit" disabled={salvando} className={`${maxHubPrimaryButton} w-full`}>
            {salvando ? "Cadastrando…" : "Concluir cadastro"}
          </button>
        </form>
      </Card>
    </MaxHubAuthShell>
  );
}
