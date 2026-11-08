import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ETAPAS,
  LINK_INDISPONIVEL,
  LINK_TOKEN_RE,
  dataBr,
  juntarNomes,
  primeiroNome,
  type AcompanhamentoPublico,
} from "@/lib/link-acompanhamento";
import { lerAcompanhamento } from "@/lib/link-acompanhamento.functions";

// Link de acompanhamento do negócio (t_54c79bdc). Sem login, um link por lado (comprador/vendedor).
// Lê o status da venda pelo servidor (acompanhamento_publico): nada de valores nem dados pessoais.
// Mesmo padrão do /lead-form/$token: ssr:false, noindex e sem referrer.
export const Route = createFileRoute("/acompanhar/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Acompanhe seu negócio" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AcompanharPage,
});

function AcompanharPage() {
  const { token } = Route.useParams();
  const valido = LINK_TOKEN_RE.test(token);
  const [estado, setEstado] = useState<"carregando" | "indisponivel" | "aberto">(
    valido ? "carregando" : "indisponivel",
  );
  const [dados, setDados] = useState<AcompanhamentoPublico | null>(null);

  useEffect(() => {
    if (!valido) return;
    lerAcompanhamento({ data: { token } })
      .then((r) => {
        if (r.ok) {
          setDados(r.dados);
          setEstado("aberto");
        } else setEstado("indisponivel");
      })
      .catch(() => setEstado("indisponivel"));
  }, [token, valido]);

  return (
    <div className="min-h-dvh bg-[#eef1f6] px-3 py-6 text-[#1d2433] sm:py-10">
      <main className="mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#e2e5ec]">
        <header className="bg-[#003DA5] px-5 py-4 text-white">
          <p className="text-sm font-semibold opacity-90">{dados?.imobiliaria || "\u00a0"}</p>
          <h1 className="text-lg font-bold">Acompanhe seu negócio</h1>
        </header>
        {estado === "carregando" && (
          <p className="px-5 py-14 text-center text-sm text-[#5d6678]" role="status">
            Carregando…
          </p>
        )}
        {estado === "indisponivel" && (
          <div className="px-6 py-14 text-center" data-testid="link-indisponivel">
            <div className="mb-3 text-3xl" aria-hidden="true">
              🔒
            </div>
            <p className="text-base font-medium">{LINK_INDISPONIVEL}</p>
          </div>
        )}
        {estado === "aberto" && dados && <Conteudo d={dados} />}
      </main>
    </div>
  );
}

function Conteudo({ d }: { d: AcompanhamentoPublico }) {
  const proprios = d.lado === "comprador" ? d.compradores : d.vendedores;
  const ola = primeiroNome(proprios[0]);
  const datas = [d.datas.preparando, d.datas.aguardando, d.datas.assinado];
  const corretor = primeiroNome(d.corretor);
  return (
    <div className="space-y-4 px-5 py-5">
      {ola && <p className="text-base font-semibold">Olá, {ola}!</p>}

      {d.etapa === 3 && (
        <section className="rounded-xl bg-[#e9f6ee] p-4 text-center" data-testid="assinado">
          <p className="text-lg font-bold text-[#1B7F3B]">🎉 Contrato assinado!</p>
          <p className="mt-1 text-sm">Obrigado pela confiança.</p>
          {d.google_url && (
            <>
              <p className="mt-2 text-sm">Pode contar como foi o atendimento?</p>
              <a
                href={d.google_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block rounded-full bg-[#003DA5] px-5 py-2.5 text-sm font-semibold text-white"
                data-testid="avaliar-google"
              >
                ⭐ Avaliar no Google
              </a>
            </>
          )}
        </section>
      )}

      {(d.imovel.linha1 || d.imovel.linha2) && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#5d6678]">Imóvel</h2>
          {d.imovel.linha1 && <p className="font-medium">{d.imovel.linha1}</p>}
          {d.imovel.linha2 && <p className="text-sm text-[#5d6678]">{d.imovel.linha2}</p>}
        </section>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#5d6678]">Partes</h2>
        <dl className="mt-1 space-y-0.5 text-sm">
          {d.compradores.length > 0 && (
            <div>
              <dt className="inline text-[#5d6678]">
                {d.compradores.length > 1 ? "Compradores" : "Comprador"}:{" "}
              </dt>
              <dd className="inline">{juntarNomes(d.compradores)}</dd>
            </div>
          )}
          {d.vendedores.length > 0 && (
            <div>
              <dt className="inline text-[#5d6678]">
                {d.vendedores.length > 1 ? "Vendedores" : "Vendedor"}:{" "}
              </dt>
              <dd className="inline">{juntarNomes(d.vendedores)}</dd>
            </div>
          )}
          {d.corretor && (
            <div>
              <dt className="inline text-[#5d6678]">Corretor: </dt>
              <dd className="inline">{d.corretor}</dd>
            </div>
          )}
        </dl>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#5d6678]">Andamento</h2>
        <ol className="mt-2" aria-label="Andamento">
          {ETAPAS.map((nome, i) => {
            const n = i + 1;
            const feito = n < d.etapa || (n === 3 && d.etapa === 3);
            const atual = n === d.etapa && !feito;
            const data = n <= d.etapa ? dataBr(datas[i]) : null;
            return (
              <li
                key={nome}
                className="relative flex gap-3 pb-4 last:pb-0"
                aria-current={atual ? "step" : undefined}
                data-etapa={n}
                data-situacao={feito ? "feito" : atual ? "atual" : "futuro"}
              >
                {n < 3 && (
                  <span
                    className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 ${n < d.etapa ? "bg-[#1B7F3B]" : "bg-[#e2e5ec]"}`}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    feito
                      ? "bg-[#1B7F3B] text-white"
                      : atual
                        ? "bg-[#003DA5] text-white ring-4 ring-[#003DA5]/15"
                        : "bg-[#e2e5ec] text-[#5d6678]"
                  }`}
                  aria-hidden="true"
                >
                  {feito ? "✓" : n}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm ${atual || feito ? "font-semibold" : "text-[#5d6678]"}`}>
                    {nome}
                  </p>
                  {data && <p className="text-xs text-[#5d6678]">{data}</p>}
                  {atual && <p className="text-xs font-medium text-[#003DA5]">Etapa atual</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="space-y-1 border-t border-[#e2e5ec] pt-3 text-center text-xs text-[#5d6678]">
        {dataBr(d.atualizado_em) && <p>Última atualização: {dataBr(d.atualizado_em)}</p>}
        {corretor && (
          <p>
            Dúvidas? Fale com <b className="text-[#1d2433]">{corretor}</b>, seu corretor.
          </p>
        )}
        <p className="font-medium">Este link é só seu. Não compartilhe.</p>
      </footer>
    </div>
  );
}
