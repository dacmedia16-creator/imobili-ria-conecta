/**
 * "Reabrir plano" (t_495e4305): regra do motivo, igual à do banco (carreira_plano_reabrir: 5 a 300 caracteres,
 * sem contar espaços nas pontas).
 */
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 300;
export const motivoValido = (m: string) => {
  const n = m.trim().length;
  return n >= MOTIVO_MIN && n <= MOTIVO_MAX;
};
