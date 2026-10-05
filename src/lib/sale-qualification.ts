import type { PartyRow } from "@/lib/database.types";
import { parteSortKey } from "@/lib/status";

const clean = (v: string | null | undefined) => v?.trim() || null;

function pessoaFisica(p: Partial<PartyRow>, nome: string, conjuge = false): string {
  const infos = [
    nome,
    clean(conjuge ? p.conjuge_nacionalidade : p.nacionalidade),
    !conjuge && clean(p.estado_civil)
      ? `${clean(p.estado_civil)}${p.regime_casamento?.trim() ? ` sob o regime de ${p.regime_casamento.trim()}` : ""}`
      : !conjuge && clean(p.regime_casamento)
        ? `sob o regime de ${p.regime_casamento!.trim()}`
        : null,
    clean(conjuge ? p.conjuge_profissao : p.profissao),
    clean(conjuge ? p.conjuge_rg : p.rg)
      ? `portador(a) do RG nº ${clean(conjuge ? p.conjuge_rg : p.rg)}`
      : null,
    clean(conjuge ? p.conjuge_cpf : p.cpf_cnpj)
      ? `inscrito(a) no CPF sob nº ${clean(conjuge ? p.conjuge_cpf : p.cpf_cnpj)}`
      : null,
    clean(conjuge ? p.conjuge_endereco : p.endereco)
      ? `residente e domiciliado(a) em ${clean(conjuge ? p.conjuge_endereco : p.endereco)}`
      : null,
  ];
  return infos.filter(Boolean).join(", ") + ".";
}

export function qualificacaoCompleta(parties: Record<string, PartyRow>): string {
  const papeis = Object.keys(parties)
    .filter((papel) => /^(vendedor|comprador)_\d+$/.test(papel))
    .sort((a, b) => {
      const x = parteSortKey(a), y = parteSortKey(b);
      return x[0] - y[0] || x[1] - y[1];
    });
  const lados = (["vendedor", "comprador"] as const).map((tipo) => {
    const textos = papeis.filter((papel) => papel.startsWith(`${tipo}_`)).flatMap((papel) => {
      const p = parties[papel];
      const nome = clean(p.razao_social) ?? clean(p.nome);
      if (!nome) return [];
      const texto = p.tipo_pessoa === "juridica"
        ? [nome, clean(p.cnpj) ? `inscrita no CNPJ sob nº ${clean(p.cnpj)}` : null,
          clean(p.endereco) ? `com sede em ${clean(p.endereco)}` : null,
          clean(p.nome) ? `representada por ${clean(p.nome)}${clean(p.cpf_cnpj) ? `, CPF nº ${clean(p.cpf_cnpj)}` : ""}${clean(p.rg) ? `, RG nº ${clean(p.rg)}` : ""}` : null,
        ].filter(Boolean).join(", ") + "."
        : pessoaFisica(p, nome);
      const conjuge = clean(p.conjuge_nome);
      return conjuge ? [texto, `Cônjuge: ${pessoaFisica(p, conjuge, true)}`] : [texto];
    });
    return textos.length ? `${tipo === "vendedor" ? "VENDEDORES" : "COMPRADORES"}:\n${textos.join("\n")}` : "";
  });
  return lados.filter(Boolean).join("\n\n");
}

export function listaDocumentos(
  docs: { file_name: string | null; tipo: string; parte: string; status: string }[],
  nomeTipo: (tipo: string) => string,
  nomeParte: (parte: string) => string,
): string {
  return docs.map((d) => `${nomeParte(d.parte)} — ${nomeTipo(d.tipo)}${d.file_name ? ` (${d.file_name})` : ""}: ${
    { pendente: "Pendente", enviado: "Enviado", aprovado: "Aprovado", recusado: "Recusado" }[d.status] ?? d.status
  }`).join("\n");
}
