// Vídeos da Wiki MAX (t_9bc9447e, 22/10/2026). O arquivo fica no bucket PRIVADO "wiki-midia" do
// Supabase do ADM MAX (Storage do próprio projeto: responde a pedidos parciais/Range, que o Safari
// do iPhone exige para tocar MP4; os assets estáticos do Worker não respondem). Só quem está logado
// recebe o link assinado, e só quando clica em "Assistir".
// Vídeo novo: suba o MP4 com nome versionado (…-v3.mp4), acrescente a chave aqui e no guia.
// t_62112cc6 (23/10/2026): captação v2, venda v3 em 2 partes, ajuda v1 e dados v1. O arquivo
// antigo venda/como-registrar-uma-venda-v2.mp4 continua no bucket, só para reversão.
export const WIKI_VIDEO_BUCKET = "wiki-midia";

export const WIKI_VIDEOS = {
  captacao: "captacao/captacao-exclusiva-v2.mp4",
  "venda-parte1": "venda/registrar-a-venda-parte1-v3.mp4",
  "venda-parte2": "venda/do-contrato-a-assinatura-parte2-v3.mp4",
  ajuda: "ajuda/pedir-ajuda-ou-sugestao-v1.mp4",
  dados: "dados/meus-dados-estao-errados-v1.mp4",
} as const;

export type WikiVideoChave = keyof typeof WIKI_VIDEOS;

export const WIKI_VIDEO_CHAVES = Object.keys(WIKI_VIDEOS) as [WikiVideoChave, ...WikiVideoChave[]];

/** Validade do link assinado: cobre o vídeo inteiro com folga (pausas, voltar, assistir de novo). */
export const WIKI_VIDEO_LINK_SEGUNDOS = 4 * 60 * 60;
