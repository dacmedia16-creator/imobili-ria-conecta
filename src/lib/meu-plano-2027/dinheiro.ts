/**
 * Campos em R$ do Meu Plano 2027 (t_cd9141ab, Denis 23/11, tópico 6238): o campo mostra "R$ 400.000" /
 * "R$ 400.000,50" enquanto digita e depois de preenchido; o que vai para o banco é o número puro ("400000",
 * "400000.5"), lido igual por num() (regras.ts) e por carreira_plano_num (SQL). Nada no banco muda de tipo.
 */
import { num, ok, type Valor } from "./regras";

const MAX_DIGITOS = 12; // R$ 999.999.999.999

const milhar = (d: string) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export type Mascara = { texto: string; valor: string };

/**
 * Texto digitado → { texto mostrado no campo, valor gravado }. Ponto é sempre separador de milhar (quem digita
 * "400.000" tecla a tecla chega em 400 mil, não em 400), vírgula é a dos centavos (até 2).
 * `colado`: texto colado no formato americano ("500.00") vira 500,00.
 * shortcut: colado "1.500" (sem centavos) é lido como mil e quinhentos, igual a num().
 */
export function mascaraDinheiro(bruto: string, colado = false): Mascara {
  let s = bruto.replace(/R\$|\s/g, "");
  if (colado && !s.includes(",") && /^\d+\.\d{1,2}$/.test(s)) s = s.replace(".", ",");
  const i = s.indexOf(",");
  const temVirgula = i >= 0;
  const inteiro = (temVirgula ? s.slice(0, i) : s)
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, MAX_DIGITOS);
  const cent = temVirgula
    ? s
        .slice(i + 1)
        .replace(/\D/g, "")
        .slice(0, 2)
    : "";
  if (!inteiro && !temVirgula) return { texto: "", valor: "" };
  const int = inteiro || "0";
  const texto = `R$ ${milhar(int)}${temVirgula ? `,${cent}` : ""}`;
  return { texto, valor: String(Number(`${int}.${cent || "0"}`)) };
}

/**
 * Valor gravado → texto do campo fora da edição. Número (inclusive gravado antes no formato livre, ex.:
 * "400.000,00") aparece como "R$ 400.000"; com centavos, "R$ 400.000,50". Texto que não é número (gravado
 * antes da máscara, ex.: "Ainda sem histórico") aparece como está, para o corretor ver e corrigir.
 */
export function mostraDinheiro(v: Valor): string {
  if (v === undefined || v === null || typeof v === "boolean") return "";
  const t = String(v).trim();
  if (!t) return "";
  const n = num(v);
  if (!ok(n) || n < 0) return t;
  const [int, cent] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  return `R$ ${milhar(int)}${cent === "00" ? "" : `,${cent}`}`;
}
