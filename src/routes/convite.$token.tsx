import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  MaxHubAuthShell,
  MaxHubEyebrow,
  MaxHubMark,
  maxHubPrimaryButton,
} from "@/components/MaxHubAuthShell";
import { INVITE_TOKEN_RE, pendingInviteStorage, savePendingInvite } from "@/lib/org-invites";
import { contaMaxLoginUrl } from "@/lib/dominios";

// Link do e-mail de convite (t_6e4dab96). Guarda o token no navegador (localStorage, 30 min, uso único) e leva para o login da Conta MAX
// (o mesmo "Entrar com Google" do ADM). Na volta, /conta-max confere o e-mail e abre o cadastro.
export const Route = createFileRoute("/convite/$token")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Convite — ADM MAX" }, { name: "referrer", content: "no-referrer" }],
  }),
  component: ConvitePage,
});

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";

function ConvitePage() {
  const { token } = Route.useParams();
  const valido = INVITE_TOKEN_RE.test(token);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!valido) return;
    savePendingInvite(pendingInviteStorage(window), token);
    setPronto(true);
  }, [token, valido]);

  const entrar = contaMaxLoginUrl(IS_HOMOLOG ? "adm-max-homolog" : "adm-max");

  return (
    <MaxHubAuthShell footer={IS_HOMOLOG ? "ADM MAX · Ambiente de homologação" : "ADM MAX"}>
      <section
        aria-labelledby="convite-titulo"
        className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-[#071325]/70 p-7 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] backdrop-blur-sm sm:p-9"
      >
        <div className="flex items-center gap-3">
          <MaxHubMark className="h-10 w-10" />
          <MaxHubEyebrow>Convite · ADM MAX</MaxHubEyebrow>
        </div>
        {valido ? (
          <>
            <h1 id="convite-titulo" className="mt-8 font-maxhub-display text-2xl font-bold">
              Cadastre sua imobiliária
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              Primeiro, entre com a conta Google do e-mail que recebeu este convite. Depois você
              preenche os dados da imobiliária e os seus. Não é preciso criar senha.
            </p>
            <a
              href={entrar}
              aria-disabled={!pronto}
              className={`${maxHubPrimaryButton} mt-7 w-full ${pronto ? "" : "pointer-events-none opacity-60"}`}
            >
              Entrar com Google
              <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
            </a>
            <p className="mt-5 text-center text-xs leading-relaxed text-[#a9b8cf]">
              O convite é pessoal e vale 7 dias. Com outra conta Google, o cadastro não é liberado.
            </p>
          </>
        ) : (
          <>
            <h1 id="convite-titulo" className="mt-8 font-maxhub-display text-2xl font-bold">
              Link de convite inválido
            </h1>
            <p role="alert" className="mt-3 text-sm leading-relaxed text-white/80">
              Este link não é válido. Confira se copiou o endereço inteiro do e-mail ou peça um
              novo convite ao UniHub.
            </p>
          </>
        )}
      </section>
    </MaxHubAuthShell>
  );
}
