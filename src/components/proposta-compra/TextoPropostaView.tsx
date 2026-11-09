import type { Item, TextoProposta } from "@/lib/proposta-compra-texto";

// Texto oficial da proposta em tela (t_b4e7c368): o mesmo conteúdo que o PDF desenha, montado por
// montarTextoProposta. Usado no link público para a parte ler a proposta inteira antes do "Li e concordo".

function Itens({ itens }: { itens: Item[] }) {
  return (
    <>
      {itens.map((i, k) => {
        if (i.tipo === "campos")
          return (
            <dl key={k} className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {i.campos.map((c, j) => (
                <div key={j} className={c.largo ? "sm:col-span-2" : undefined}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#5d6678]">
                    {c.rotulo}
                  </dt>
                  <dd className="min-h-[1.25rem] text-sm">{c.valor || "—"}</dd>
                </div>
              ))}
            </dl>
          );
        if (i.tipo === "subtitulo")
          return (
            <h4 key={k} className="pt-1 text-sm font-semibold">
              {i.texto}
            </h4>
          );
        if (i.tipo === "par")
          return (
            <p
              key={k}
              className={`${i.recuo ? "pl-3" : ""} ${i.pequeno ? "text-xs" : "text-sm"} leading-relaxed`}
            >
              {i.texto}
            </p>
          );
        if (i.tipo === "valor_total")
          return (
            <p key={k} className="text-sm">
              <strong className="text-base">{i.valor}</strong> ({i.extenso})
            </p>
          );
        return (
          <div key={k} className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[#5d6678]">
                  {i.cabecalho.map((h) => (
                    <th key={h} className="py-1 pr-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {i.linhas.map((l, j) => (
                  <tr key={j} className="border-t border-[#e2e5ec] align-top">
                    {l.map((c, m) => (
                      <td key={m} className="py-1 pr-2">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

export function TextoPropostaView({ texto }: { texto: TextoProposta }) {
  return (
    <article className="space-y-4" data-testid="texto-oficial">
      <header className="text-center">
        <p className="text-sm font-semibold">{texto.cabecalho.nome}</p>
        {texto.cabecalho.linha && <p className="text-xs text-[#5d6678]">{texto.cabecalho.linha}</p>}
        <h2 className="mt-2 text-base font-bold">{texto.titulo}</h2>
        <p className="text-xs text-[#5d6678]">{texto.subtitulo}</p>
      </header>
      <p className="text-sm leading-relaxed">{texto.abertura}</p>
      {texto.secoes.map((s, n) => (
        <section key={n} className="space-y-2">
          <h3 className="text-sm font-bold text-[#003DA5]">
            {s.titulo}
          </h3>
          <Itens itens={s.itens} />
        </section>
      ))}
      <p className="text-sm leading-relaxed">{texto.fecho}</p>
      <p className="text-[11px] text-[#5d6678]">{texto.rodape.legal}</p>
    </article>
  );
}
