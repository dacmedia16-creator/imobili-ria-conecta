// Texto OFICIAL da proposta de compra (t_b4e7c368). Fonte: proposta-oficial.md, que é a proposta da Campolim
// ajustada e aprovada por Denis em 09/11/2026. O texto NÃO é reescrito aqui: as frases são as do modelo, com as
// variáveis e os trechos condicionais marcados nele. Funções puras, sem rede.
// O resultado é uma lista de blocos que o PDF (proposta-compra-pdf.ts) e o link público (proposta.$token.tsx)
// desenham iguais.
// AVISO INTERNO: o texto ainda depende da aprovação do advogado (TEXTO_APROVADO_ADVOGADO = false).
// Sem essa aprovação e sem o "sim" de Denis, nada é publicado.
import { formatBRL } from "@/lib/formato-moeda";
import {
  TEXTO_APROVADO_ADVOGADO,
  precisaConjuge,
  type Cadastro,
  type EstadoCivil,
  type FormaPagamento,
  type Papel,
  type SinalTipo,
  type Termos,
} from "@/lib/proposta-compra";

// --- Valor e número por extenso (mesma lógica da Campolim) -------------------------------------------------
const U = [
  "",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const D = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const C = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const p: string[] = [];
  if (c) p.push(C[c]);
  if (r) {
    if (r < 20) p.push(U[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      p.push(u ? `${D[d]} e ${U[u]}` : D[d]);
    }
  }
  return p.join(" e ");
}
/** Inteiro por extenso no masculino: 2 → "dois", 1500 → "mil e quinhentos". */
export function inteiroExtenso(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  n = Math.floor(n);
  if (n === 0) return "zero";
  const grupos: [string, string][] = [
    ["", ""],
    ["mil", "mil"],
    ["milhão", "milhões"],
    ["bilhão", "bilhões"],
  ];
  const blocos: number[] = [];
  let resto = n;
  while (resto > 0) {
    blocos.push(resto % 1000);
    resto = Math.floor(resto / 1000);
  }
  const partes: { t: string; b: number }[] = [];
  for (let i = blocos.length - 1; i >= 0; i--) {
    const b = blocos[i];
    if (!b) continue;
    const t =
      i === 1 && b === 1
        ? "mil"
        : ate999(b) + (i ? ` ${b === 1 ? grupos[i][0] : grupos[i][1]}` : "");
    partes.push({ t, b });
  }
  return partes
    .map((p, k) => {
      if (k === 0) return p.t;
      const ultimo = k === partes.length - 1;
      return (ultimo && (p.b < 100 || p.b % 100 === 0) ? " e " : " ") + p.t;
    })
    .join("");
}
/** R$ por extenso: 650000 → "seiscentos e cinquenta mil reais". */
export function valorExtenso(valor: number): string {
  const v = Math.round((Number(valor) || 0) * 100);
  const r = Math.floor(v / 100);
  const c = v % 100;
  let txt = r
    ? inteiroExtenso(r) + (r === 1 ? " real" : r % 1000000 === 0 ? " de reais" : " reais")
    : "";
  if (c) txt += (txt ? " e " : "") + ate999(c) + (c === 1 ? " centavo" : " centavos");
  return txt || "zero reais";
}
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
/** "2026-11-09" → "9 de novembro de 2026". */
export function dataExtenso(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Data civil + N dias corridos. */
export function somarDiasIso(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const brl = (n: number) => formatBRL(n);
const comExtenso = (n: number) => `${brl(n)} (${valorExtenso(n)})`;

export function formatarDoc(d: string | null | undefined): string | null {
  const x = (d ?? "").replace(/\D/g, "");
  if (x.length === 11) return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
  if (x.length === 14)
    return `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}`;
  return null;
}
export function formatarCelular(t: string | null | undefined): string | null {
  const d = (t ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}
/** "CRECI: 29.886-J" / "CRECI/SP 38.086-J" → "29.886-J" (o texto já escreve "CRECI"). */
export const limparCreci = (c: string | null | undefined): string | null =>
  (c ?? "").replace(/^\s*CRECI(\s*\/\s*[A-Z]{2})?\s*[:\-–]?\s*/i, "").trim() || null;

const EC_TEXTO: Record<EstadoCivil, string> = {
  solteiro: "solteiro(a)",
  casado: "casado(a)",
  uniao_estavel: "união estável",
  divorciado: "divorciado(a)",
  viuvo: "viúvo(a)",
  separado: "separado(a)",
};

// --- Entrada ------------------------------------------------------------------------------------------------
export type ParteTexto = {
  papel: Papel;
  ordem: number;
  tipoPessoa: "fisica" | "juridica";
  nome: string | null;
  cpfCnpj: string | null;
  estadoCivil: EstadoCivil | null;
  telefone: string | null;
  email: string | null;
};
export type TextoInput = {
  documento: string;
  versao: number;
  imovel: Partial<
    Record<
      | "tipo"
      | "endereco"
      | "complemento"
      | "bairro"
      | "cidade"
      | "uf"
      | "matricula"
      | "cartorio"
      | "iptu"
      | "codigo",
      string | null
    >
  >;
  valorOferta: number | null;
  formaPagamento: FormaPagamento | null;
  sinalValor: number | null;
  sinalPrazoDias: number | null;
  sinalTipo: SinalTipo;
  financiamentoBanco: string | null;
  financiamentoValor: number | null;
  validadeDias: number;
  prazoContratoDias: number | null;
  certidoes: "vendedor_apresenta" | "dispensadas" | null;
  observacoes: string | null;
  termos: Termos;
  cadastro: Cadastro;
  /** Data do documento (fixada com o PDF). Sem ela, usa a data de hoje (só na prévia). */
  documentoData: string | null;
  corretorNome: string | null;
  partes: ParteTexto[];
};

// --- Saída --------------------------------------------------------------------------------------------------
export type Campo = { rotulo: string; valor: string; largo?: boolean };
export type Item =
  | { tipo: "campos"; campos: Campo[] }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "par"; texto: string; recuo?: boolean; pequeno?: boolean }
  | { tipo: "valor_total"; valor: string; extenso: string }
  | {
      tipo: "signatarios";
      cabecalho: [string, string, string];
      linhas: [string, string, string][];
    };
export type Secao = { titulo: string; itens: Item[] };
export type TextoProposta = {
  cabecalho: { nome: string; linha: string | null };
  titulo: string;
  subtitulo: string;
  abertura: string;
  secoes: Secao[];
  fecho: string;
  rodape: { esquerda: string; legal: string };
  /** Dados do cadastro que faltam (o trecho sai do texto; o corretor vê o aviso). */
  avisos: string[];
  /** Marcação interna enquanto o advogado não aprovar (null depois de aprovado). */
  marcaInterna: string | null;
};

export const MARCA_MINUTA = "Minuta: texto pendente de aprovação do advogado.";
const LEGAL_RODAPE =
  "Documento preparado para assinatura eletrônica (MP 2.200-2/2001 e Lei 14.063/2020).";

/** O que falta no cadastro para o texto (nome sempre existe). */
export function faltasCadastro(c: Cadastro, comCorretor = true): string[] {
  const f: string[] = [];
  if (!c.razao_social) f.push("razão social");
  if (!c.cnpj) f.push("CNPJ");
  if (!limparCreci(c.creci)) f.push("CRECI-J");
  if (!c.endereco) f.push("endereço");
  const avisos: string[] = [];
  if (f.length)
    avisos.push(
      `O cadastro da imobiliária está sem ${f.join(", ")}. Esse dado fica fora da proposta até o administrador completar em Dados da imobiliária.`,
    );
  if (comCorretor && !limparCreci(c.corretor_creci))
    avisos.push("O seu perfil está sem CRECI: a proposta sai sem o CRECI do corretor.");
  return avisos;
}

const letras = () => {
  let i = 0;
  return () => `${String.fromCharCode(97 + i++)}) `;
};
const temValor = (n: number | null | undefined): n is number => n != null && n > 0;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export function montarTextoProposta(p: TextoInput, hojeIso: string): TextoProposta {
  const cad = p.cadastro;
  const nome = cad.nome ?? "";
  const creciJ = limparCreci(cad.creci);
  const cnpj = formatarDoc(cad.cnpj);
  const data = p.documentoData ?? hojeIso;
  const local =
    p.termos.local ?? ([cad.cidade, cad.uf].filter(Boolean).join("/") || null);
  const localData = `${local ? `${local}, ` : ""}${dataExtenso(data)}`;
  const t = p.termos;

  const partes = p.partes;
  const comprador = partes.find((x) => x.papel === "comprador");
  const compPJ = comprador?.tipoPessoa === "juridica";
  const compConj = partes.find((x) => x.papel === "comprador_conjuge");
  const compCasado = !compPJ && precisaConjuge(comprador?.estadoCivil);
  const vendedores = partes
    .filter((x) => x.papel === "vendedor")
    .sort((a, b) => a.ordem - b.ordem);
  const conjVend = (o: number) =>
    partes.find((x) => x.papel === "vendedor_conjuge" && x.ordem === o);
  const vendCasado = vendedores.some(
    (v) => v.tipoPessoa === "fisica" && precisaConjuge(v.estadoCivil),
  );
  const corretor = partes.find((x) => x.papel === "corretor");
  const corretorNome = corretor?.nome ?? p.corretorNome;
  const creciCorretor = limparCreci(cad.corretor_creci);

  const campos = (lista: (Campo | null | false)[]): Item => ({
    tipo: "campos",
    campos: lista.filter((c): c is Campo => !!c && !!c.valor),
  });
  const secoes: Secao[] = [];
  const sec = (titulo: string, itens: Item[]) =>
    secoes.push({ titulo: `${secoes.length + 1}. ${titulo}`, itens });

  // Cabeçalho e abertura (dados da imobiliária do cadastro; o que falta não aparece).
  const linha = [
    cad.razao_social,
    cnpj ? `CNPJ ${cnpj}` : null,
    creciJ ? `CRECI ${creciJ}` : null,
    cad.endereco,
  ]
    .filter(Boolean)
    .join(" · ");
  const ident = [cad.razao_social, cnpj ? `CNPJ ${cnpj}` : null, creciJ ? `CRECI ${creciJ}` : null]
    .filter(Boolean)
    .join(", ");
  const abertura = `Pela presente, o(a) PROPONENTE abaixo qualificado(a) apresenta ao(à) VENDEDOR(A), por intermédio da ${nome}${ident ? ` (${ident})` : ""}, proposta firme de compra do imóvel descrito a seguir, que o(a) obriga nos termos e no prazo de validade aqui fixados (arts. 427 e 428 do Código Civil).`;

  // 1. Proponente comprador(a)
  if (compPJ)
    sec("Proponente comprador(a)", [
      campos([
        { rotulo: "Razão social", valor: comprador?.nome ?? "", largo: true },
        { rotulo: "CNPJ", valor: formatarDoc(comprador?.cpfCnpj) ?? "" },
        { rotulo: "Representante legal", valor: t.comprador_representante ?? "" },
        {
          rotulo: "CPF do representante",
          valor: formatarDoc(t.comprador_representante_cpf) ?? "",
        },
        { rotulo: "Cargo", valor: t.comprador_cargo ?? "" },
        { rotulo: "Endereço", valor: t.comprador_endereco ?? "", largo: true },
        { rotulo: "Celular/WhatsApp", valor: formatarCelular(comprador?.telefone) ?? "" },
        { rotulo: "E-mail", valor: comprador?.email ?? "" },
      ]),
    ]);
  else
    sec("Proponente comprador(a)", [
      campos([
        { rotulo: "Nome", valor: comprador?.nome ?? "", largo: true },
        { rotulo: "CPF", valor: formatarDoc(comprador?.cpfCnpj) ?? "" },
        { rotulo: "RG", valor: t.comprador_rg ?? "" },
        { rotulo: "Nacionalidade", valor: t.comprador_nacionalidade ?? "" },
        { rotulo: "Profissão", valor: t.comprador_profissao ?? "" },
        {
          rotulo: "Estado civil",
          valor: comprador?.estadoCivil ? EC_TEXTO[comprador.estadoCivil] : "",
        },
        compCasado && { rotulo: "Regime de bens", valor: t.comprador_regime ?? "" },
        compCasado && { rotulo: "Cônjuge / companheiro(a)", valor: compConj?.nome ?? "" },
        compCasado && {
          rotulo: "CPF do cônjuge / companheiro(a)",
          valor: formatarDoc(compConj?.cpfCnpj) ?? "",
        },
        { rotulo: "Endereço", valor: t.comprador_endereco ?? "", largo: true },
        { rotulo: "Celular/WhatsApp", valor: formatarCelular(comprador?.telefone) ?? "" },
        { rotulo: "E-mail", valor: comprador?.email ?? "" },
      ]),
    ]);

  // 2. Vendedor(a) / proprietário(a)
  {
    const informados = vendedores.filter((v) => v.nome || v.cpfCnpj);
    const itens: Item[] = [];
    if (!informados.length)
      itens.push({
        tipo: "par",
        texto: "Proprietário(s) do imóvel descrito abaixo, conforme a matrícula.",
      });
    for (const v of informados) {
      if (informados.length > 1) itens.push({ tipo: "subtitulo", texto: `Vendedor(a) ${v.ordem}` });
      const casado = v.tipoPessoa === "fisica" && precisaConjuge(v.estadoCivil);
      const cj = conjVend(v.ordem);
      itens.push(
        campos([
          {
            rotulo: "Nome / razão social",
            valor: v.nome ?? "Proprietário(s) do imóvel",
            largo: true,
          },
          { rotulo: "CPF / CNPJ", valor: formatarDoc(v.cpfCnpj) ?? "" },
          {
            rotulo: "Estado civil",
            valor: v.tipoPessoa === "fisica" && v.estadoCivil ? EC_TEXTO[v.estadoCivil] : "",
          },
          casado && { rotulo: "Cônjuge / companheiro(a)", valor: cj?.nome ?? "" },
          casado && {
            rotulo: "CPF do cônjuge / companheiro(a)",
            valor: formatarDoc(cj?.cpfCnpj) ?? "",
          },
          { rotulo: "E-mail", valor: v.email ?? "" },
          { rotulo: "Celular/WhatsApp", valor: formatarCelular(v.telefone) ?? "" },
        ]),
      );
    }
    sec("Vendedor(a) / proprietário(a)", itens);
  }

  // 3. Imóvel
  {
    const im = p.imovel;
    const rua = [im.endereco, im.complemento].filter(Boolean).join(", ");
    const lugar = [im.bairro, [im.cidade, im.uf].filter(Boolean).join("/")]
      .filter(Boolean)
      .join(" - ");
    sec("Imóvel", [
      campos([
        { rotulo: "Descrição", valor: t.imovel_descricao ?? im.tipo ?? "", largo: true },
        { rotulo: "Endereço", valor: [rua, lugar].filter(Boolean).join(" - "), largo: true },
        { rotulo: "Matrícula nº", valor: im.matricula ?? "" },
        { rotulo: "Cartório de Registro de Imóveis", valor: im.cartorio ?? "" },
        { rotulo: "Inscrição municipal (IPTU)", valor: im.iptu ?? "" },
        { rotulo: "Código", valor: im.codigo ?? "" },
      ]),
    ]);
  }

  // 4. Preço e forma de pagamento
  {
    const L = letras();
    const itens: Item[] = [];
    const total = p.valorOferta ?? 0;
    itens.push({ tipo: "valor_total", valor: brl(total), extenso: valorExtenso(total) });
    const temSinal =
      temValor(p.sinalValor) &&
      (p.formaPagamento === "sinal_financiamento" || p.formaPagamento === "sinal_parcelas");
    if (temSinal) {
      const n = p.sinalPrazoDias ?? 2;
      const prazo = `em até ${n} (${inteiroExtenso(n)}) ${plural(n, "dia útil", "dias úteis")} após o aceite desta proposta`;
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Sinal e princípio de pagamento (arras): ${comExtenso(p.sinalValor as number)}, por ${t.sinal_forma ?? "PIX"}, ${prazo}, em conta de titularidade do(a) vendedor(a)${t.vendedor_conta ? ` - ${t.vendedor_conta}` : ""}. O comprovante de pagamento valerá como recibo.`,
      });
    }
    if (temValor(t.proprios_valor))
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Recursos próprios: ${comExtenso(t.proprios_valor)}, ${t.proprios_quando ?? "na assinatura da escritura"}.`,
      });
    if (temValor(t.fgts_valor))
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Recursos do FGTS do(a) proponente: ${comExtenso(t.fgts_valor)}, liberados pelo agente financeiro.`,
      });
    const fin = p.formaPagamento === "sinal_financiamento" && temValor(p.financiamentoValor);
    if (fin)
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Financiamento bancário${p.financiamentoBanco ? ` (${p.financiamentoBanco})` : ""}: ${comExtenso(p.financiamentoValor as number)}, pago diretamente ao(à) vendedor(a) pela instituição financeira.`,
      });
    if (temValor(t.permuta_valor) || t.permuta_descricao)
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Permuta: ${t.permuta_descricao ?? "bem a ser descrito"}${temValor(t.permuta_valor) ? `, avaliado(a) pelas partes em ${comExtenso(t.permuta_valor)}` : ""}, entregue livre e desembaraçado de ônus, dívidas e ações.`,
      });
    if (t.parcelas)
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Parcelas diretas com o(a) vendedor(a): ${t.parcelas}`,
      });
    if (t.pagamento_obs)
      itens.push({ tipo: "par", recuo: true, texto: `Condições de pagamento: ${t.pagamento_obs}` });
    itens.push({
      tipo: "par",
      recuo: true,
      pequeno: true,
      texto:
        "Nenhum valor desta proposta será pago em conta da imobiliária ou do(a) corretor(a), salvo autorização expressa e por escrito do(a) vendedor(a).",
    });
    sec("Preço e forma de pagamento", itens);

    // 5. Sinal (arras) — o tipo escolhido pelo corretor (padrão confirmatórias).
    sec("Sinal (arras)", [
      {
        tipo: "par",
        texto:
          p.sinalTipo === "penitenciais"
            ? "O sinal é pago a título de arras penitenciais (art. 420 do Código Civil), assegurado às partes o direito de arrependimento até a assinatura do contrato de compra e venda: se o(a) proponente desistir, perderá o sinal em favor do(a) vendedor(a); se o(a) vendedor(a) desistir, devolverá o sinal em dobro, com correção monetária pelo IPCA. Em qualquer caso, não haverá outra indenização entre as partes."
            : "O sinal é pago a título de arras confirmatórias (arts. 417 a 419 do Código Civil), torna o negócio firme e será abatido do preço. Se o(a) proponente desistir sem justo motivo, perderá o sinal em favor do(a) vendedor(a); se o(a) vendedor(a) desistir, devolverá o sinal em dobro, com correção monetária pelo IPCA, sem prejuízo do disposto no art. 419 do Código Civil.",
      },
    ]);

    // 6. Financiamento e FGTS (só se houver)
    if (fin || temValor(t.fgts_valor))
      sec("Financiamento e FGTS", [
        {
          tipo: "par",
          texto: `A compra depende da aprovação do crédito e/ou da liberação do FGTS. O(a) proponente entregará a documentação ao agente financeiro em até 10 (dez) dias do aceite. Se o crédito ou o FGTS não for aprovado em até ${t.fin_prazo_dias ?? 30} dias da entrega da documentação, por motivo que não dependa do(a) proponente (como reprovação de crédito, avaliação do imóvel abaixo do necessário ou impedimento documental do imóvel), o negócio será desfeito sem multa para nenhuma das partes e o sinal será devolvido integralmente, com correção pelo IPCA, em até 5 (cinco) dias úteis. O(a) vendedor(a) se compromete a fornecer os documentos exigidos e a permitir a vistoria de avaliação do imóvel.`,
        },
      ]);
  }

  // 7. Situação do imóvel
  {
    const L = letras();
    const itens: Item[] = [
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}O(a) vendedor(a) declara que o imóvel será transferido livre e desembaraçado de ônus, dívidas, penhoras, ações e restrições que impeçam ou prejudiquem a venda, e que não há débitos de IPTU, condomínio ou consumo em aberto, ou que eles serão quitados até a entrega das chaves.`,
      },
    ];
    if (p.certidoes !== "dispensadas")
      itens.push({
        tipo: "par",
        recuo: true,
        texto: `${L()}Se as certidões do imóvel e do(a) vendedor(a), a serem obtidas antes da assinatura do contrato, apontarem ônus, ações ou débitos capazes de comprometer o imóvel ou a venda e não forem resolvidos pelo(a) vendedor(a) em até 30 (trinta) dias da comunicação, o(a) proponente poderá desistir do negócio, com devolução integral e corrigida do sinal, sem multa.`,
      });
    itens.push({
      tipo: "par",
      recuo: true,
      texto: `${L()}O(a) proponente declara que visitou o imóvel e o aceita no estado de conservação em que se encontra, ressalvados os vícios ocultos, que seguem a lei.`,
    });
    sec("Situação do imóvel", itens);
  }

  // 8. Itens que permanecem no imóvel
  sec("Itens que permanecem no imóvel", [
    {
      tipo: "par",
      texto: t.itens
        ? `${t.itens} Esses itens integram o preço e serão entregues em funcionamento, no estado em que estavam na visita.`
        : "Nenhum item além das benfeitorias fixas que integram o imóvel.",
    },
  ]);

  // 9. Posse, despesas e débitos
  {
    const L = letras();
    sec("Posse, despesas e débitos", [
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}Entrega das chaves (posse): ${t.posse ?? "na data da assinatura da escritura, com o imóvel livre e desocupado"}. Até lá, o imóvel continua sob responsabilidade do(a) vendedor(a).`,
      },
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}Débitos do imóvel (IPTU, condomínio, consumo de água, luz e gás) até a data da entrega das chaves são de responsabilidade do(a) vendedor(a); a partir dela, do(a) proponente.`,
      },
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}ITBI, escritura e registro são de responsabilidade do(a) proponente, conforme o art. 490 do Código Civil, salvo acordo diferente nesta proposta.`,
      },
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}Aceita esta proposta, as partes firmarão o contrato (compromisso) de compra e venda em até ${p.prazoContratoDias ?? 15} dias, detalhando as condições aqui ajustadas, que prevalecem em caso de dúvida.`,
      },
    ]);
  }

  // 10. Intermediação e comissão (corretor parceiro: ainda não existe no ADM MAX — trecho não entra).
  {
    const quem = t.comissao_quem ?? "vendedor(a)";
    const porMeio = corretorNome
      ? `, por meio do(a) corretor(a) ${corretorNome}${creciCorretor ? ` (CRECI ${creciCorretor})` : ""}`
      : "";
    const comissao =
      quem === "conforme a autorização de venda"
        ? "A comissão de corretagem segue o contrato de intermediação (autorização de venda) firmado com o(a) proprietário(a)."
        : `A comissão de corretagem é de responsabilidade do(a) ${quem}, conforme o contrato de intermediação.`;
    sec("Intermediação e comissão", [
      {
        tipo: "par",
        texto: `Este negócio é intermediado pela ${nome}${porMeio}. ${comissao} Aceita esta proposta, considera-se obtido o resultado da intermediação para os fins do art. 725 do Código Civil.`,
      },
    ]);
  }

  // 11. Outras condições (só se houver)
  if (p.observacoes) sec("Outras condições", [{ tipo: "par", texto: p.observacoes }]);

  // 12. Validade e aceite (D9: dias corridos contados da data do documento)
  {
    const dias = Math.max(1, Math.round(p.validadeDias || 5));
    const ate = dataBR(somarDiasIso(data, dias));
    sec("Validade e aceite", [
      {
        tipo: "par",
        texto: `Esta proposta é válida por ${dias} ${plural(dias, "dia corrido", "dias corridos")}, até 23h59 de ${ate}. O aceite se dá pela assinatura eletrônica do(a) vendedor(a)${vendCasado ? " e de seu cônjuge ou companheiro(a)" : ""} neste documento dentro desse prazo. Aceite fora do prazo, ou com alterações, vale como nova proposta (art. 431 do Código Civil).`,
      },
    ]);
  }

  // 13. Assinatura eletrônica, dados pessoais e foro
  {
    const L = letras();
    sec("Assinatura eletrônica, dados pessoais e foro", [
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}As partes concordam em assinar este documento eletronicamente, por link individual enviado a cada signatário pelo WhatsApp, com confirmação por código de 6 (seis) dígitos enviado ao mesmo número. A plataforma registra, para cada assinatura, data e hora, endereço IP, aparelho/navegador e o hash (impressão digital) do documento, que constam da página "Comprovação das assinaturas" anexada a este documento. Alterado o texto ou os valores após alguma assinatura, as assinaturas anteriores deixam de valer. As partes reconhecem a validade dessa assinatura e a admitem como meio de comprovação de autoria e integridade (MP 2.200-2/2001, art. 10, § 2º; Lei 14.063/2020), dispensada a assinatura de testemunhas (art. 784, § 4º, do Código de Processo Civil).`,
      },
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}Os dados pessoais desta proposta serão usados apenas para a negociação, a formalização e o registro da compra, nos termos da Lei 13.709/2018 (LGPD).`,
      },
      {
        tipo: "par",
        recuo: true,
        texto: `${L()}Fica eleito o foro da comarca de situação do imóvel para resolver qualquer questão sobre esta proposta.`,
      },
    ]);
  }

  // Signatários
  {
    const docCel = (doc: string | null | undefined, tel: string | null | undefined) =>
      `${formatarDoc(doc) ?? "—"} · ${formatarCelular(tel) ?? "—"}`;
    const linhas: [string, string, string][] = [];
    if (comprador)
      linhas.push([
        comprador.nome ?? "—",
        compPJ
          ? `Proponente comprador(a)${t.comprador_representante ? ` · representada por ${t.comprador_representante}` : ""}`
          : "Proponente comprador(a)",
        docCel(
          compPJ ? (t.comprador_representante_cpf ?? comprador.cpfCnpj) : comprador.cpfCnpj,
          comprador.telefone,
        ),
      ]);
    if (compConj)
      linhas.push([
        compConj.nome ?? "—",
        "Cônjuge / companheiro(a) do(a) proponente",
        docCel(compConj.cpfCnpj, compConj.telefone),
      ]);
    for (const v of vendedores) {
      linhas.push([
        v.nome ?? "—",
        "Vendedor(a) - assinatura = aceite",
        docCel(v.cpfCnpj, v.telefone),
      ]);
      const cj = conjVend(v.ordem);
      if (cj)
        linhas.push([
          cj.nome ?? "—",
          "Cônjuge do(a) vendedor(a) - outorga (art. 1.647 do CC)",
          docCel(cj.cpfCnpj, cj.telefone),
        ]);
    }
    if (corretor)
      linhas.push([
        corretor.nome ?? "—",
        `Corretor(a) ${nome}${creciCorretor ? ` · CRECI ${creciCorretor}` : ""}`,
        `— · ${formatarCelular(corretor.telefone) ?? "—"}`,
      ]);
    sec("Signatários", [
      { tipo: "signatarios", cabecalho: ["Nome", "Papel", "CPF/CNPJ · Celular"], linhas },
    ]);
  }

  return {
    cabecalho: { nome, linha: linha || null },
    titulo: "PROPOSTA DE COMPRA DE IMÓVEL",
    subtitulo: `Nº ${p.documento} · ${localData}`,
    abertura,
    secoes,
    fecho: `${localData}. As assinaturas eletrônicas, com data, hora e identificação de cada signatário, constam da página "Comprovação das assinaturas", gerada pelo ADM MAX e anexada a este documento.`,
    rodape: { esquerda: `Proposta nº ${p.documento} · ${nome}`, legal: LEGAL_RODAPE },
    avisos: faltasCadastro(cad),
    marcaInterna: TEXTO_APROVADO_ADVOGADO ? null : MARCA_MINUTA,
  };
}

/** Texto corrido (para busca nos testes e para a conferência do conteúdo). */
export function textoPlano(t: TextoProposta): string {
  const out: string[] = [t.cabecalho.nome, t.cabecalho.linha ?? "", t.titulo, t.subtitulo, t.abertura];
  for (const s of t.secoes) {
    out.push(s.titulo);
    for (const i of s.itens) {
      if (i.tipo === "campos") out.push(...i.campos.map((c) => `${c.rotulo}: ${c.valor}`));
      else if (i.tipo === "subtitulo" || i.tipo === "par") out.push(i.texto);
      else if (i.tipo === "valor_total") out.push(`${i.valor} (${i.extenso})`);
      else out.push(...i.linhas.map((l) => l.join(" | ")));
    }
  }
  out.push(t.fecho);
  return out.join("\n");
}
