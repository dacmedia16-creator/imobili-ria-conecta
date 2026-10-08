/** "Código interno" da venda (nº da ocorrência): 9 dígitos + hífen + 1 a 3 dígitos, ex. 630591023-665.
 * Espelha a CHECK sales_codigo_interno_formato (migration 20261008120000), que é a autoridade. */
export const CODIGO_INTERNO_REGEX = /^[0-9]{9}-[0-9]{1,3}$/;

/** Máscara do input: aceita só dígitos (o que não for dígito é descartado) e insere o hífen depois do
 * 9º dígito; o sufixo fica limitado a 3 dígitos. */
export function mascararCodigoInterno(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 12);
  if (digitos.length <= 9) return digitos;
  return `${digitos.slice(0, 9)}-${digitos.slice(9)}`;
}

/** Vazio é permitido (campo opcional); preenchido precisa estar completo no padrão. */
export function codigoInternoValido(valor: string | null | undefined): boolean {
  const v = (valor ?? "").trim();
  return v === "" || CODIGO_INTERNO_REGEX.test(v);
}

export const CODIGO_INTERNO_ERRO =
  "Código interno incompleto: use 9 dígitos, hífen e 1 a 3 dígitos (ex.: 630591023-665).";
