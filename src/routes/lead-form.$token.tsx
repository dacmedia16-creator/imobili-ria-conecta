import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  MaxHubAuthShell,
  MaxHubEyebrow,
  MaxHubMark,
  maxHubPrimaryButton,
} from "@/components/MaxHubAuthShell";
import {
  CONSENTIMENTO_LGPD,
  FORM_TOKEN_RE,
  pareceRobo,
  validarFormPublico,
  type FormPublico,
} from "@/lib/leads";
import { enviarFormularioLead, lerFormularioLead } from "@/lib/leads-form.functions";

// Formulário público de TESTE do piloto de leads (P2, card t_9a8dccc7). Sem login.
// Só funciona quando o administrador liga o formulário e o módulo Leads está ligado na imobiliária.
// ?imovel=<id da captação> liga o lead ao imóvel (vai para o captador). Nada é enviado ao cliente.
export const Route = createFileRoute("/lead-form/$token")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    imovel:
      typeof s.imovel === "string" && /^[0-9a-f-]{36}$/i.test(s.imovel) ? s.imovel : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Fale com a imobiliária" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: FormularioLead,
});

const CAMPO =
  "h-10 w-full rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40";

const VAZIO: FormPublico = {
  nome: "",
  telefone: "",
  email: "",
  mensagem: "",
  consentimento: false,
  site: "",
};

function FormularioLead() {
  const { token } = Route.useParams();
  const { imovel } = Route.useSearch();
  const valido = FORM_TOKEN_RE.test(token);
  const [estado, setEstado] = useState<"carregando" | "indisponivel" | "aberto" | "enviado">(
    valido ? "carregando" : "indisponivel",
  );
  const [imobiliaria, setImobiliaria] = useState("");
  const [f, setF] = useState<FormPublico>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abertoEm = useRef(Date.now());

  useEffect(() => {
    if (!valido) return;
    lerFormularioLead({ data: { token } })
      .then((r) => {
        if (r.ok) {
          setImobiliaria(r.imobiliaria);
          abertoEm.current = Date.now();
          setEstado("aberto");
        } else setEstado("indisponivel");
      })
      .catch(() => setEstado("indisponivel"));
  }, [token, valido]);

  const set = <K extends keyof FormPublico>(k: K, v: FormPublico[K]) =>
    setF((x) => ({ ...x, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = validarFormPublico(f);
    if (msg) return setErro(msg);
    setErro(null);
    setBusy(true);
    try {
      const agora = Date.now();
      if (pareceRobo(f, abertoEm.current, agora)) {
        // Mesmo resultado visível para gente e robô; o servidor também confere.
        setEstado("enviado");
        return;
      }
      const r = await enviarFormularioLead({
        data: {
          token,
          nome: f.nome,
          telefone: f.telefone,
          email: f.email,
          mensagem: f.mensagem,
          imovel: imovel ?? null,
          consentimento: true,
          site: f.site,
          abertoHaMs: agora - abertoEm.current,
        },
      });
      if (r.ok) setEstado("enviado");
      else if (r.erro === "limite")
        setErro("Muitos envios em pouco tempo. Tente de novo mais tarde.");
      else if (r.erro === "indisponivel") setEstado("indisponivel");
      else if (r.erro === "contato") setErro("Confira o nome, o telefone ou o e-mail.");
      else setErro("Não foi possível enviar. Confira os dados e tente de novo.");
    } catch {
      setErro("Não foi possível enviar. Confira os dados e tente de novo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MaxHubAuthShell footer="Formulário de teste · ADM MAX">
      <section
        aria-labelledby="lead-form-titulo"
        className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-[#071325]/70 p-7 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] backdrop-blur-sm sm:p-9"
      >
        <div className="flex items-center gap-3">
          <MaxHubMark className="h-10 w-10" />
          <MaxHubEyebrow>{imobiliaria || "Imobiliária"}</MaxHubEyebrow>
        </div>

        {estado === "carregando" && <p className="mt-8 text-sm text-white/70">Carregando…</p>}

        {estado === "indisponivel" && (
          <>
            <h1 id="lead-form-titulo" className="mt-8 font-maxhub-display text-2xl font-bold">
              Formulário indisponível
            </h1>
            <p className="mt-3 text-sm text-white/80">Este link não está ativo no momento.</p>
          </>
        )}

        {estado === "enviado" && (
          <>
            <h1 id="lead-form-titulo" className="mt-8 font-maxhub-display text-2xl font-bold">
              Recebemos seu contato
            </h1>
            <p className="mt-3 text-sm text-white/80">
              Um corretor da imobiliária vai retornar em breve. Obrigado!
            </p>
          </>
        )}

        {estado === "aberto" && (
          <form onSubmit={enviar} className="mt-6 grid gap-3" noValidate>
            <h1 id="lead-form-titulo" className="font-maxhub-display text-2xl font-bold">
              Quero ser atendido
            </h1>
            <p className="text-xs text-white/60">Informe telefone ou e-mail para o retorno.</p>
            <label className="grid gap-1 text-sm">
              Nome
              <input
                className={CAMPO}
                value={f.nome}
                maxLength={120}
                autoComplete="name"
                onChange={(e) => set("nome", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Telefone (WhatsApp)
              <input
                className={CAMPO}
                value={f.telefone}
                inputMode="tel"
                maxLength={30}
                autoComplete="tel"
                onChange={(e) => set("telefone", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              E-mail
              <input
                className={CAMPO}
                type="email"
                value={f.email}
                maxLength={160}
                autoComplete="email"
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Mensagem (opcional)
              <textarea
                className={`${CAMPO} h-24 py-2`}
                value={f.mensagem}
                maxLength={1000}
                onChange={(e) => set("mensagem", e.target.value)}
              />
            </label>
            {/* Armadilha anti-robô: invisível para pessoas e leitores de tela. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Site
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={f.site}
                  onChange={(e) => set("site", e.target.value)}
                />
              </label>
            </div>
            <label className="flex items-start gap-2 text-xs leading-relaxed text-white/80">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={f.consentimento}
                onChange={(e) => set("consentimento", e.target.checked)}
              />
              <span>{CONSENTIMENTO_LGPD}</span>
            </label>
            {erro && (
              <p role="alert" className="text-sm text-red-300">
                {erro}
              </p>
            )}
            <button type="submit" disabled={busy} className={`${maxHubPrimaryButton} mt-2 w-full`}>
              {busy ? "Enviando…" : "Enviar"}
            </button>
          </form>
        )}
      </section>
    </MaxHubAuthShell>
  );
}
