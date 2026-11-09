import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  PAPEL_LABEL,
  SITUACAO_LABEL,
  AVISO_TEXTO_ADVOGADO,
  TOKEN_RE,
  textoErroAssinatura,
  type ErroPublico,
  type PropostaPublica,
} from "@/lib/proposta-compra";
import { assinarPropostaLink, lerPropostaLink } from "@/lib/proposta-compra.functions";
import { dataBr, dataHoraSp, textoDaPublica } from "@/lib/proposta-compra-tela";
import { montarTextoProposta } from "@/lib/proposta-compra-texto";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { TextoPropostaView } from "@/components/proposta-compra/TextoPropostaView";

// Página pública do link da proposta de compra (t_da0dac53). Sem login, um link por parte.
// Mesmo padrão do /acompanhar/$token: ssr:false, noindex e sem referrer. Mostra SÓ a proposta (lista
// fechada lida pelo servidor) com o TEXTO OFICIAL inteiro (t_b4e7c368) e pede o código de 6 dígitos +
// "Li e concordo".
export const Route = createFileRoute("/proposta/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Proposta de compra" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PropostaLinkPage,
});

const MSG_ERRO: Record<ErroPublico, string> = {
  indisponivel: "Esta proposta não está disponível. Fale com o seu corretor.",
  limite: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  invalido: "Não foi possível abrir a proposta. Tente de novo.",
  vencida: "Esta proposta venceu. Fale com o seu corretor.",
};

function PropostaLinkPage() {
  const { token } = Route.useParams();
  return <PropostaLink token={token} />;
}

export function PropostaLink({ token }: { token: string }) {
  const valido = TOKEN_RE.test(token);
  const [estado, setEstado] = useState<"carregando" | "erro" | "aberto">(
    valido ? "carregando" : "erro",
  );
  const [erro, setErro] = useState<ErroPublico>("indisponivel");
  const [dados, setDados] = useState<PropostaPublica | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!valido) return;
    let vivo = true;
    lerPropostaLink({ data: { token } })
      .then((r) => {
        if (!vivo) return;
        if (r.ok) {
          setDados(r.dados);
          setEstado("aberto");
        } else {
          setErro(r.erro);
          setEstado("erro");
        }
      })
      .catch(() => vivo && setEstado("erro"));
    return () => {
      vivo = false;
    };
  }, [token, valido, recarga]);

  return (
    <div className="min-h-dvh bg-[#eef1f6] px-3 py-5 text-[#1d2433] sm:py-10">
      <main className="mx-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#e2e5ec]">
        <header className="bg-[#003DA5] px-5 py-4 text-white">
          <p className="text-sm font-semibold opacity-90">{dados?.imobiliaria || "\u00a0"}</p>
          <h1 className="text-lg font-bold">Proposta de compra</h1>
          {dados && (
            <p className="text-xs opacity-80">
              Documento {dados.documento} · versão {dados.versao}
            </p>
          )}
        </header>
        {estado === "carregando" && (
          <p className="px-5 py-14 text-center text-sm text-[#5d6678]" role="status">
            Carregando…
          </p>
        )}
        {estado === "erro" && (
          <div className="px-6 py-14 text-center" data-testid="link-indisponivel">
            <div className="mb-3 text-3xl" aria-hidden="true">
              🔒
            </div>
            <p className="text-base font-medium">{MSG_ERRO[erro]}</p>
          </div>
        )}
        {estado === "aberto" && dados && (
          <Conteudo d={dados} token={token} recarregar={() => setRecarga((n) => n + 1)} />
        )}
      </main>
    </div>
  );
}

function Conteudo({
  d,
  token,
  recarregar,
}: {
  d: PropostaPublica;
  token: string;
  recarregar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assinou, setAssinou] = useState<string | null>(d.voce.assinadoEm);
  const texto = useMemo(() => montarTextoProposta(textoDaPublica(d), hojeSaoPaulo()), [d]);
  const totalVend = d.partes.filter((p) => p.papel === "vendedor").length;
  const rot = (papel: PropostaPublica["partes"][number]["papel"], ordem: number) =>
    `${PAPEL_LABEL[papel]}${(papel === "vendedor" || papel === "vendedor_conjuge") && totalVend > 1 ? ` ${ordem}` : ""}`;
  const pode = d.situacao === "aguardando_assinaturas" && !assinou;

  const assinar = async () => {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await assinarPropostaLink({
        data: { token, codigo, conteudoHash: d.conteudoHash, aceite: true },
      });
      if (r.ok) {
        setAssinou(new Date().toISOString());
        setMsg(r.faltam === 0 ? "Todas as partes assinaram. Proposta aceita!" : null);
      } else {
        setMsg(textoErroAssinatura(r));
        if (r.erro === "versao_mudou") recarregar();
      }
    } catch {
      setMsg("Não foi possível confirmar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-5 px-5 py-5">
      {d.voce.nome && (
        <p className="text-base font-semibold">
          Olá, {d.voce.nome.trim().split(/\s+/)[0]}!{" "}
          <span className="font-normal">
            Você assina como {rot(d.voce.papel, d.voce.ordem).toLowerCase()}.
          </span>
        </p>
      )}
      <p className="text-sm text-[#5d6678]">
        Situação: <strong>{SITUACAO_LABEL[d.situacao]}</strong>
        {d.validadeAte ? ` · válida até ${dataBr(d.validadeAte)}` : ""}
      </p>

      <section>
        <h2 className="mb-1 text-sm font-bold text-[#003DA5]">Partes</h2>
        <ul className="space-y-1 text-sm" data-testid="partes-publicas">
          {d.partes.map((p) => (
            <li key={`${p.papel}-${p.ordem}`} className="flex items-center justify-between gap-2">
              <span>
                <span className="text-[#5d6678]">{rot(p.papel, p.ordem)}:</span> {p.nome ?? "—"}
              </span>
              <span className={p.assinou ? "text-[#1B7F3B]" : "text-[#5d6678]"}>
                {p.assinou ? "✓ assinou" : "aguardando"}
              </span>
            </li>
          ))}
        </ul>
        {d.voce.documentoFinal && (
          <p className="mt-1 text-xs text-[#5d6678]">
            Seu documento termina em {d.voce.documentoFinal}.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-[#003DA5]">Leia a proposta inteira</h2>
        <div
          className="max-h-[70vh] overflow-y-auto rounded-xl border border-[#e2e5ec] bg-[#fbfcfe] p-4"
          tabIndex={0}
          aria-label="Texto da proposta"
        >
          <TextoPropostaView texto={texto} />
        </div>
      </section>

      <section
        className="rounded-xl border border-[#d4a017] bg-[#fff8e1] p-3 text-sm"
        data-testid="clausulas-pendentes-publico"
      >
        <p className="font-semibold">{AVISO_TEXTO_ADVOGADO}</p>
      </section>

      {assinou ? (
        <section className="rounded-xl bg-[#e9f6ee] p-4 text-center" data-testid="assinado">
          <p className="text-lg font-bold text-[#1B7F3B]">✓ Assinatura registrada</p>
          <p className="mt-1 text-sm">{dataHoraSp(assinou)}</p>
          {msg && <p className="mt-1 text-sm font-medium">{msg}</p>}
        </section>
      ) : pode ? (
        <section className="space-y-3 rounded-xl bg-[#f4f6fb] p-4" data-testid="assinar">
          <label htmlFor="codigo" className="block text-sm font-semibold">
            Código recebido no WhatsApp
          </label>
          <input
            id="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="h-12 w-full rounded-lg border border-[#c9cfdb] bg-white px-3 text-center text-2xl tracking-[0.4em]"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5"
              checked={aceite}
              onChange={(e) => setAceite(e.target.checked)}
              data-testid="li-e-concordo"
            />
            <span>Li a proposta inteira e concordo com ela.</span>
          </label>
          {msg && (
            <p className="text-sm text-[#b42318]" role="alert" data-testid="erro-assinatura">
              {msg}
            </p>
          )}
          <button
            type="button"
            className="h-12 w-full rounded-full bg-[#003DA5] text-base font-semibold text-white disabled:opacity-50"
            disabled={enviando || codigo.length !== 6 || !aceite}
            onClick={() => void assinar()}
            data-testid="botao-assinar"
          >
            {enviando ? "Confirmando…" : "Li e concordo, assinar"}
          </button>
        </section>
      ) : null}

      {d.corretor.whatsapp && (
        <p className="text-center text-sm">
          Dúvidas?{" "}
          <a
            className="font-semibold text-[#003DA5] underline"
            href={d.corretor.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            Fale com seu corretor
          </a>
        </p>
      )}
    </div>
  );
}
