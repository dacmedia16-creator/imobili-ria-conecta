// Vídeos da Wiki MAX (t_9bc9447e, 22/10/2026). O arquivo fica no bucket PRIVADO "wiki-midia" do
// Supabase do ADM MAX (Storage do próprio projeto: responde a pedidos parciais/Range, que o Safari
// do iPhone exige para tocar MP4; os assets estáticos do Worker não respondem). Só quem está logado
// recebe o link assinado, e só quando clica em "Assistir".
// Vídeo novo: suba o MP4 com nome versionado (…-v3.mp4), acrescente a chave aqui e no guia.
// t_62112cc6 (23/10/2026): captação v2, venda v3 em 2 partes, ajuda v1 e dados v1. O arquivo
// antigo venda/como-registrar-uma-venda-v2.mp4 continua no bucket, só para reversão.
// t_57d7f0e7 (23/10/2026): mais 8 vídeos v1 (entrar, inicio, carreira, feedback, oportunidades,
// mural, sala, visita), todos no arquivo original (< 50 MB).
export const WIKI_VIDEO_BUCKET = "wiki-midia";

export const WIKI_VIDEOS = {
  captacao: "captacao/captacao-exclusiva-v2.mp4",
  "venda-parte1": "venda/registrar-a-venda-parte1-v3.mp4",
  "venda-parte2": "venda/do-contrato-a-assinatura-parte2-v3.mp4",
  ajuda: "ajuda/pedir-ajuda-ou-sugestao-v1.mp4",
  dados: "dados/meus-dados-estao-errados-v1.mp4",
  entrar: "entrar/como-entrar-nos-sistemas-v1.mp4",
  inicio: "inicio/tela-inicio-v1.mp4",
  carreira: "carreira/minha-carreira-v1.mp4",
  feedback: "feedback/feedback-ao-proprietario-v1.mp4",
  oportunidades: "oportunidades/oportunidades-entre-corretores-v1.mp4",
  mural: "mural/mural-de-conquistas-v1.mp4",
  sala: "sala/reservar-sala-de-reuniao-v1.mp4",
  visita: "visita/registrar-visita-com-prova-v1.mp4",
} as const;

export type WikiVideoChave = keyof typeof WIKI_VIDEOS;

export const WIKI_VIDEO_CHAVES = Object.keys(WIKI_VIDEOS) as [WikiVideoChave, ...WikiVideoChave[]];

/** Validade do link assinado: cobre o vídeo inteiro com folga (pausas, voltar, assistir de novo). */
export const WIKI_VIDEO_LINK_SEGUNDOS = 4 * 60 * 60;
