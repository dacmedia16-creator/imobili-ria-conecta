// Tour guiado de primeiro acesso do ADM MAX (card t_2e09bc40, pedido de Denis em 26/10/2026).
// Lógica pura: monta os passos a partir do MESMO menu que a barra lateral mostra (montarMenuLateral
// já filtrado por papel e módulos ligados). Assim o tour nunca aponta para um item que a pessoa não vê.
// Textos genéricos para qualquer imobiliária: sem nome de imobiliária ou de rede, só "ADM MAX".
import type { NavGroup } from "@/lib/menu-lateral";

/** Nome do tour gravado no banco (tabela user_tour_estado). */
export const TOUR_ADM_INICIO = "adm_inicio";
/** Evento para abrir o tour de novo (botão "Ver tour de novo" nos Guias de Ajuda). */
export const TOUR_EVENTO_INICIAR = "adm-max:tour-iniciar";
/** Quantas vezes o tour abre sozinho (a trava real fica no banco, função tour_registrar_abertura). */
export const TOUR_MAX_ABERTURAS = 3;
/** Marca da sessão da aba: recarregar a página ou trocar de tela não conta como novo acesso. */
export const chaveTourSessao = (userId: string) =>
  `adm-max:tour:${TOUR_ADM_INICIO}:sessao:${userId}`;

export type TourStatus = "concluido" | "fechado";

/**
 * true = é um acesso novo (primeira checagem nesta sessão da aba) e já marca a sessão.
 * Sem armazenamento disponível devolve false (não abre sozinho, para não abrir a cada recarga).
 */
export function novoAcessoNaSessao(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  userId: string,
): boolean {
  if (!storage) return false;
  try {
    const chave = chaveTourSessao(userId);
    if (storage.getItem(chave) !== null) return false;
    storage.setItem(chave, "1");
    return true;
  } catch {
    return false;
  }
}

/** Ao sair da conta, a próxima entrada nesta aba volta a contar como acesso novo. */
export function limparAcessosDaSessao(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | null,
) {
  if (!storage) return;
  try {
    const prefixo = `adm-max:tour:${TOUR_ADM_INICIO}:sessao:`;
    const chaves: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(prefixo)) chaves.push(k);
    }
    chaves.forEach((k) => storage.removeItem(k));
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

export type PassoTour = {
  /** Seletor CSS do elemento real. Sem seletor = balão centralizado (celular). */
  seletor?: string;
  titulo: string;
  texto: string;
};

/** Identificador estável de cada área do menu (usado no atributo data-tour da barra lateral). */
export function idDaArea(label: string | undefined): string {
  const base = (label ?? "inicio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "inicio";
}

/** Frase curta de cada área. Área sem frase aqui ainda entra no tour, só com a lista dos itens. */
const FRASE_DA_AREA: Record<string, { titulo: string; frase: string }> = {
  inicio: { titulo: "Início", frase: "Seu ponto de partida, com o resumo do dia a dia." },
  "vendas-e-captacoes": {
    titulo: "Vendas e captações",
    frase: "Registre e acompanhe suas vendas e captações.",
  },
  equipe: {
    titulo: "Equipe",
    frase: "Acompanhe o desempenho e a organização das equipes e reserve salas.",
  },
  "relatorios-detalhados": {
    titulo: "Relatórios",
    frase: "Números e relatórios para consultar os resultados.",
  },
  "conta-e-acesso": {
    titulo: "Conta e acesso",
    frase: "Seus avisos, seus dados de acesso e o canal de ajuda.",
  },
  administracao: {
    titulo: "Administração",
    frase: "Cadastros e ajustes da imobiliária. Só aparece para quem tem permissão.",
  },
  plataforma: {
    titulo: "Plataforma",
    frase: "Imobiliárias, usuários e chamados de todas as imobiliárias. Só para a equipe MAX.",
  },
};

/** "A", "A e B", "A, B e C"; com mais de `max` itens: "A, B, C, D e mais 3" (balão curto). */
export function listaEmTexto(itens: string[], max = 4): string {
  if (itens.length > max) return `${itens.slice(0, max).join(", ")} e mais ${itens.length - max}`;
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export const PASSO_GUIAS_TITULO = "Comece pelos Guias de Ajuda";
const PASSO_GUIAS_TEXTO =
  "Bem-vindo ao ADM MAX! Aqui ficam os guias com passo a passo e vídeos curtos de cada tela. " +
  "Sempre que tiver dúvida, comece por eles.";
const PASSO_GUIAS_TEXTO_CELULAR =
  "Bem-vindo ao ADM MAX! Os guias com passo a passo e vídeos curtos ficam neste menu, " +
  "em Conta e acesso. Sempre que tiver dúvida, comece por eles.";
const PASSO_AJUDA_TITULO = "Precisa de ajuda?";
const PASSO_AJUDA_TEXTO =
  "Por este botão você relata um erro, tira uma dúvida ou dá uma ideia. " +
  "Para ver este tour de novo, abra os Guias de Ajuda.";

/**
 * Passos do tour, na ordem: 1) Guias de Ajuda; 2) uma área do menu por passo (só as que têm item
 * visível); 3) botão de ajuda. No celular a barra lateral fica fechada: o 1º passo aponta para o
 * botão do menu e as áreas viram balões centralizados (sem apontar para item escondido).
 */
export function montarPassosTour(groups: NavGroup[], opts: { celular: boolean }): PassoTour[] {
  const { celular } = opts;
  const passos: PassoTour[] = [];
  const wikiVisivel = groups.some((g) => g.items.some((i) => i.show && i.to === "/ajuda/wiki"));

  if (wikiVisivel) {
    passos.push(
      celular
        ? {
            seletor: '[data-tour="menu-celular"]',
            titulo: PASSO_GUIAS_TITULO,
            texto: PASSO_GUIAS_TEXTO_CELULAR,
          }
        : {
            seletor: 'aside [data-tour="item-guias"]',
            titulo: PASSO_GUIAS_TITULO,
            texto: PASSO_GUIAS_TEXTO,
          },
    );
  }

  for (const g of groups) {
    const visiveis = g.items.filter((i) => i.show);
    if (visiveis.length === 0) continue;
    const id = idDaArea(g.label);
    const info = FRASE_DA_AREA[id];
    const titulo = info?.titulo ?? g.label ?? "Início";
    const itens = `Aqui você encontra: ${listaEmTexto(visiveis.map((i) => i.label))}.`;
    const texto = [info?.frase, itens, celular ? "Abra pelo menu ☰." : null]
      .filter(Boolean)
      .join(" ");
    passos.push(
      celular ? { titulo, texto } : { seletor: `aside [data-tour="area-${id}"]`, titulo, texto },
    );
  }

  passos.push({
    seletor: celular ? '[data-tour="ajuda-celular"]' : '[data-tour="ajuda-computador"]',
    titulo: PASSO_AJUDA_TITULO,
    texto: PASSO_AJUDA_TEXTO,
  });
  return passos;
}

/**
 * Abre sozinho só para a própria pessoa: nunca em "Ver como" (a sessão é de outro usuário) nem no
 * acesso da plataforma (dentro ou fora de uma imobiliária). Nesses casos o tour só abre pelo botão,
 * e a escolha não é gravada.
 */
export function podeGravarTour(ctx: {
  impersonando: boolean;
  emVisaoDaPlataforma: boolean;
  platformAdmin: boolean;
}): boolean {
  return !ctx.impersonando && !ctx.emVisaoDaPlataforma && !ctx.platformAdmin;
}

/** Converte o motivo de encerramento do driver.js na escolha gravada (null = não grava). */
export function statusDoEncerramento(motivo: string | undefined): TourStatus | null {
  if (motivo === "done") return "concluido";
  if (motivo === "close" || motivo === "escape" || motivo === "overlay") return "fechado";
  return null; // "replaced"/"api": tela trocada ou saída; o tour volta no próximo acesso.
}
