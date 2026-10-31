// t_99359490 (Denis, 31/10, tópico 6238): permuta com detalhes, resposta repetida e ortografia da Nicole.
// Lógica pura, sem rede e sem import de leads-ia (para não criar ciclo). O roteiro (leads-ia.ts) usa estas funções
// só quando a imobiliária tem lead_config.ia_permuta_detalhes ligada (hoje só a ZZ).
//
// Regra de Denis: "quando for permuta não diga que o corretor confirma na visita, pergunta sobre os detalhes da
// permuta; quando ele responder, diz que vai avisar um corretor para verificar e você encaminha para o corretor."

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// "Troca por terreno?" = o cliente OFERECE um terreno na troca (caso Leonardo 09:42), nunca procura terreno.
const BENS_TROCA =
  "(carro|carros|moto|caminhao|caminhonete|veiculo|imovel|apartamento|apto|ap|casa|terreno|lote|sobrado|chacara|sitio|fazenda|sala|loja|galpao|barracao)";
/** "troca por terreno", "trocar pela minha casa", "troco num carro", "aceita trocar por uma linda chácara". */
export const TROCA_BEM_RE = new RegExp(
  `\\b(troca|trocar|troco|trocaria|trocamos)\\b( \\S+){0,3} (por|pelo|pela|com|em|num|numa) (um |uma |o |a |meu |minha |o meu |a minha )?(linda |lindo |bela |belo |otima |otimo |boa |bom )?${BENS_TROCA}\\b`,
);
/** "eu tenho um terreno" logo depois de falar em troca também é permuta (contexto vem do roteiro). */
export const TENHO_BEM_RE = new RegExp(`\\b(tenho|possuo)\\b( \\S+){0,2} ${BENS_TROCA}\\b`);

const BEM_RE = new RegExp(`\\b${BENS_TROCA}\\b`, "g");
const NOME_BEM: Record<string, string> = {
  carros: "carro",
  veiculo: "veículo",
  caminhao: "caminhão",
  imovel: "imóvel",
  apto: "apartamento",
  ap: "apartamento",
  chacara: "chácara",
  sitio: "sítio",
  galpao: "galpão",
  barracao: "barracão",
};
const BEM_FEM = new Set(["casa", "chácara", "fazenda", "sala", "loja", "moto", "caminhonete"]);
const VEICULO = new Set(["carro", "moto", "caminhão", "caminhonete", "veículo"]);

/** O bem oferecido na troca ("terreno", "chácara", "carro"). null = o cliente não disse qual. */
export function bemPermuta(texto: string): string | null {
  const n = norm(texto);
  const nome = (b: string | undefined) => (b ? (NOME_BEM[b] ?? b) : null);
  // 1) "meu terreno", "tenho uma chácara" = o bem é do cliente.
  const dele = new RegExp(`\\b(meu|minha|tenho|possuo|dou|dar|entro com|entrar com)\\b( \\S+){0,2}? ${BENS_TROCA}\\b`).exec(n);
  if (dele) return nome(dele[3]);
  // 2) "troca por terreno", "trocar por uma linda chácara".
  const por = new RegExp(
    `\\b(troca\\w*|troco|permut\\w*)\\b( \\S+){0,3}? (por|pelo|pela|com) (um |uma |o |a )?(linda |lindo |bela |belo |otima |otimo |boa |bom )?${BENS_TROCA}\\b`,
  ).exec(n);
  if (por) return nome(por[6]);
  // 3) "permuta com carro", "aceita moto?" (depois da palavra de troca).
  const depois = /\b(?:troca\w*|troco|permut\w*|aceita\w*)\b(.*)$/.exec(n)?.[1] ?? "";
  return nome(depois.match(BEM_RE)?.[0]);
}

/** Quantos tipos de detalhe do bem a mensagem já traz (local, tamanho, valor, situação/documento). */
export function detalhesPermuta(texto: string): number {
  const n = norm(texto);
  return [
    LOCAL_RE.test(n),
    /(\d+\s*(m2|m²|metros|mt|alqueires?|hectares?|ha\b|quartos?|dorm)|\balqueire|\bhectare|\bquartos?\b|\bsuites?\b|\bpiscina|\bcasa sede|\bpomar|\blago\b)/.test(n),
    /(\d[\d.,]*\s*(mil|k\b|milhao|milhoes|reais)|r\$|\bvale\b|\bavaliad)/.test(n),
    /\b(quitad\w*|escritura\w*|documentad\w*|documentacao|matricula|financiad\w*|ano (19|20)\d\d|km\b)/.test(n),
  ].filter(Boolean).length;
}

const doBem = (bem: string) => `${BEM_FEM.has(bem) ? "da" : "do"} ${bem}`;
const quitado = (bem: string) => `quitad${BEM_FEM.has(bem) ? "a" : "o"}`;

/** Pergunta curta dos detalhes do bem oferecido (feita 1 vez só). Se o cliente já disse onde fica, não pergunta. */
export function perguntaPermuta(bem: string | null, texto = ""): string {
  if (!bem) return "Legal! Me conta o que você quer dar na troca: o que é, onde fica, tamanho e quanto você estima que vale?";
  if (VEICULO.has(bem))
    return `Legal! Me conta um pouco ${doBem(bem)}: modelo, ano, quanto você estima que vale e se está ${quitado(bem)}?`;
  const ela = BEM_FEM.has(bem);
  const local = LOCAL_RE.test(norm(texto)) ? "" : "onde fica, ";
  const oQueTem = COM_CONSTRUCAO.has(bem) ? `, o que tem ${ela ? "nela" : "nele"}` : "";
  return `Legal! Me conta um pouco ${doBem(bem)}: ${local}tamanho${oQueTem}, quanto você estima que vale e se está ${quitado(bem)} e com a documentação em dia?`;
}
const LOCAL_RE = /\b(em|no|na|fica em|fica no|fica na|bairro|regiao de|perto de) (?!(um|uma|o|a|troca|dinheiro|parte|entrada|apartamento|ap|apto|casa)\b)[a-z]{3,}/;
/** Bens em que "o que tem nele" faz sentido (terreno e lote não). */
const COM_CONSTRUCAO = new Set(["casa", "chácara", "sítio", "fazenda", "apartamento", "sobrado", "imóvel", "sala", "loja", "galpão", "barracão"]);

/** Depois dos detalhes (mesmo parciais). O banco troca nada aqui: a passagem é verificada pelo roteiro. */
export const PERMUTA_OK = "Obrigada! Vou avisar um corretor para verificar a permuta com o proprietário e ele fala com você.";
/** O cliente não quis dar detalhes: encaminha mesmo assim, sem insistir. */
export const PERMUTA_RECUSA = "Tudo bem! Vou avisar um corretor para verificar a permuta com o proprietário e ele fala com você.";
/** O cliente volta a falar da troca depois de encaminhado (não repete a pergunta). */
export const PERMUTA_JA = "O corretor já está verificando a permuta com o proprietário e fala com você.";
/** O banco não conseguiu gravar a passagem: não afirma que alguém foi avisado. */
export const PERMUTA_FALHA = "Anotei! Um corretor da nossa equipe vai verificar a permuta com o proprietário e fala com você por aqui.";

const RECUSA_DETALHE =
  /^(nao|n|prefiro nao|agora nao|depois( eu (falo|passo|vejo))?|nao sei|so (com|pro|para o) corretor|melhor (com|falar com) o corretor|nao quero (falar|passar|dizer|informar))\b/;
/** O cliente não quis dar os detalhes ("prefiro falar com o corretor", "agora não"). */
export function recusouDetalhes(texto: string): boolean {
  const n = norm(texto);
  return RECUSA_DETALHE.test(n) && n.split(" ").length <= 8;
}

/** Linha do resumo do corretor: "PERMUTA: chácara — "<o que o cliente disse>"". */
export function resumoPermuta(p: { bem?: string; relato?: string[] }): string {
  const relato = (p.relato ?? []).map((r) => `"${r}"`).join(" / ");
  return `PERMUTA: ${p.bem ?? "bem oferecido pelo cliente"}${relato ? ` — ${relato}` : ""}`.slice(0, 450);
}

// --- Resposta repetida (item 2, caso Jidelson 16:39/17:18) -----------------------------------------------
const palavras = (t: string) =>
  norm(t.replace(/https?:\/\/\S+/g, " link "))
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
/**
 * Semelhança (0 a 1, Dice de pares de palavras) entre duas mensagens INTEIRAS. Diferente da trava do modelo
 * (leads-ia-redacao), aqui as frases padrão contam: mandar de novo "o corretor confirma..." é repetir.
 */
export function semelhancaLiteral(a: string, b: string): number {
  const pares = (t: string) => {
    const p = palavras(t);
    const s = new Map<string, number>();
    for (let i = 0; i < p.length - 1; i++) s.set(`${p[i]} ${p[i + 1]}`, (s.get(`${p[i]} ${p[i + 1]}`) ?? 0) + 1);
    return s;
  };
  const x = pares(a);
  const y = pares(b);
  let tx = 0;
  let ty = 0;
  let comum = 0;
  for (const v of x.values()) tx += v;
  for (const v of y.values()) ty += v;
  for (const [k, v] of x) comum += Math.min(v, y.get(k) ?? 0);
  if (!tx || !ty) return palavras(a).join(" ") === palavras(b).join(" ") ? 1 : 0;
  return (2 * comum) / (tx + ty);
}
/** A partir daqui é "a mesma resposta (ou quase igual)". O caso Jidelson é 1,0; respostas boas ficam abaixo de 0,6. */
export const REPETIDA_MIN = 0.8;
/** A resposta é igual (ou quase) a uma das 2 últimas da Nicole? Respostas muito curtas ("Imagina!") não contam. */
export function respostaRepetida(resposta: string, ultimasIa: string[]): boolean {
  if (palavras(resposta).length < 6) return false;
  return ultimasIa.slice(-2).some((u) => semelhancaLiteral(u, resposta) >= REPETIDA_MIN);
}

// --- Ortografia (item 3: "Trabalamos") ---------------------------------------------------------------------
const ERROS: Array<[RegExp, string]> = [
  [/\btrabal+amos\b/gi, "trabalhamos"],
  [/\btrabalhmos\b/gi, "trabalhamos"],
  [/\btrabalam\b/gi, "trabalham"],
  [/\bvoce\b/gi, "você"],
  [/\btambem\b/gi, "também"],
  [/\bimovel\b/gi, "imóvel"],
  [/\bimoveis\b/gi, "imóveis"],
  [/\bopcoes\b/gi, "opções"],
  [/\bopcao\b/gi, "opção"],
  [/\bproprietario\b/gi, "proprietário"],
  [/\bentao\b/gi, "então"],
];
/** Corrige erros comuns de digitação e acento nas respostas (mantém a maiúscula inicial; links ficam intactos). */
export function corrigirOrtografia(t: string): string {
  return t
    .split(/(https?:\/\/\S+)/)
    .map((parte, i) =>
      i % 2
        ? parte
        : ERROS.reduce(
            (s, [re, certo]) =>
              s.replace(re, (m) => (m[0] !== m[0].toLowerCase() ? certo[0].toUpperCase() + certo.slice(1) : certo)),
            parte,
          ),
    )
    .join("");
}
