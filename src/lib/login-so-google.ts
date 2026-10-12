/**
 * Login só com Google (cartões t_bcc382de / t_93e80346, aprovado por Denis em 12/10/2026).
 *
 * A senha não abre mais sessão: o hook `public.login_so_google_hook` do Supabase Auth recusa sessões
 * abertas por senha (exceto a lista de emergência `public.login_senha_emergencia`, sem tela).
 * Aqui ficam as rotas de servidor que ainda gravariam senha: elas passam a recusar o pedido.
 *
 * Acesso de emergência do dono e como desfazer: docs/MAPA_SISTEMAS_ADM_VISITA_ESTUDO.md, seção 6b
 * (repositório de operação do MAX). Para voltar ao comportamento antigo no código, troque para false.
 */
export const LOGIN_SO_GOOGLE = true;

export const SENHA_DESATIVADA =
  'Senha desativada: o acesso é só pelo botão "Entrar com Google", com o e-mail cadastrado.';
