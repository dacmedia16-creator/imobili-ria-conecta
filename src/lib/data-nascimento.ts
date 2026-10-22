/**
 * Data de nascimento no cadastro (t_dff88e75, pedido de Denis em 22/10/2026).
 *
 * Regra única (a mesma do banco, public.profile_birthdate_valida): data entre 1900-01-01 e
 * "hoje em São Paulo menos 16 anos". Formato sempre ISO (AAAA-MM-DD), igual ao <input type="date">.
 *
 * Privacidade: a data completa só aparece para a própria pessoa e para a gestão da imobiliária
 * (RPCs por pessoa). Colegas continuam vendo só dia/mês no Mural de Conquistas.
 */
export const DATA_NASCIMENTO_MIN = "1900-01-01";
export const IDADE_MINIMA = 16;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "Hoje" no fuso de São Paulo, em AAAA-MM-DD (o banco compara no mesmo fuso). */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

function dataReal(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Maior data aceita (quem completa 16 anos hoje). Usada também no `max` do campo. */
export function dataNascimentoMaxima(agora: Date = new Date()): string {
  const [y, m, d] = hojeSaoPaulo(agora).split("-").map(Number);
  // 29/02 sem ano bissexto 16 anos antes → 28/02 (mesma conta do Postgres: date - interval '16 years').
  const ano = y - IDADE_MINIMA;
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${ano}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Mensagem de erro em português, ou null se a data é válida. Vazio é tratado por quem chama. */
export function erroDataNascimento(valor: string, agora: Date = new Date()): string | null {
  const iso = valor.trim();
  if (!iso || !dataReal(iso)) return "Data de nascimento inválida.";
  if (iso < DATA_NASCIMENTO_MIN) return "A data de nascimento deve ser a partir de 1900.";
  if (iso > hojeSaoPaulo(agora)) return "A data de nascimento não pode ser no futuro.";
  if (iso > dataNascimentoMaxima(agora)) return `A idade mínima é ${IDADE_MINIMA} anos.`;
  return null;
}

/**
 * Valida um campo que pode ficar vazio. `obrigatorio` = tela do 1º acesso para quem ainda não tem
 * data. Devolve a mensagem de erro ou null.
 */
export function erroCampoDataNascimento(
  valor: string,
  obrigatorio: boolean,
  agora: Date = new Date(),
): string | null {
  if (!valor.trim()) return obrigatorio ? "Informe sua data de nascimento." : null;
  return erroDataNascimento(valor, agora);
}

/** Traduz o erro das RPCs do banco para a tela. */
export function mensagemErroRpcNascimento(err: { code?: string; message?: string } | null): string {
  if (err?.code === "22023" || /invalida/i.test(err?.message ?? ""))
    return `Data de nascimento inválida (entre 1900 e hoje, idade mínima de ${IDADE_MINIMA} anos).`;
  if (err?.code === "42501" || /permissao/i.test(err?.message ?? ""))
    return "Você não tem permissão para alterar a data de nascimento deste usuário.";
  return "Não foi possível salvar a data de nascimento agora. Tente de novo.";
}
