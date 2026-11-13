import { CAMPOS_CONTRATO, casado } from "@/lib/locacao-contrato";

export type ParteLink = "proprietario" | "locatario" | "fiador";
export type EstadoLink = { parte: ParteLink; status: string };
export const TOKEN_LINK_RE = /^[0-9a-f]{64}$/;

export function partesParaLink(garantia: string): ParteLink[] {
  return garantia === "fiador"
    ? ["proprietario", "locatario", "fiador"]
    : ["proprietario", "locatario"];
}

export function podeEnviarLinks(modo: string, garantia: string, links: EstadoLink[]): boolean {
  return (
    modo !== "cliente" ||
    partesParaLink(garantia).every((p) =>
      links.some((l) => l.parte === p && l.status === "enviado"),
    )
  );
}

/** Reutiliza os campos do contrato; nunca expõe imóvel, prazo ou outra parte. */
export function camposDaParte(parte: ParteLink, valores: Record<string, string>) {
  const secoes: Record<ParteLink, string[]> = {
    proprietario: ["proprietario", "proprietario_conj"],
    locatario: ["locatario"],
    fiador: ["fiador", "fiador_conj", "fiador_imovel"],
  };
  return CAMPOS_CONTRATO.filter((c) => secoes[parte].includes(c.secao))
    .filter(
      (c) => !c.k.endsWith("_regime") || casado(valores[c.k.replace("_regime", "_estado_civil")]),
    )
    .filter(
      (c) =>
        !c.secao.endsWith("_conj") ||
        casado(valores[c.secao === "proprietario_conj" ? "prop_estado_civil" : "fia_estado_civil"]),
    );
}
