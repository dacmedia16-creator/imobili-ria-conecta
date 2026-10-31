/**
 * Meu acesso (item 6 t_8730be75): os botões "Salvar" só ficam liberados quando a leitura do
 * perfil deu certo. Se a leitura falhou (ou não achou a linha), os campos ficam vazios na tela
 * e salvar gravaria vazio por cima do dado real — por isso a tela trava até "Tentar de novo".
 */
export type EstadoCargaPerfil = "carregando" | "ok" | "erro";

export function estadoCargaPerfil(resultado: {
  data: unknown;
  error: { message: string } | null;
}): EstadoCargaPerfil {
  if (resultado.error || resultado.data == null) return "erro";
  return "ok";
}

export function podeSalvarPerfil(estado: EstadoCargaPerfil): boolean {
  return estado === "ok";
}
