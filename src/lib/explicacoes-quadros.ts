// Ícone "i" dos quadros do Início e da Minha carreira (cartão t_f39620c8, Denis 09/11/2026, tópico 6238).
// Só textos: nada aqui muda regra, valor ou dado. As faixas citadas nos textos vêm das regras que já existem
// (nivelSemVender, faixa, sinalLeads, GESTAO_AVISO_DIAS, DIAS_NOVO, farolGeral) — o teste confere os números.
import {
  DIAS_NOVO,
  GESTAO_AVISO_DIAS,
  type ChaveSinal,
  type Farol,
  type Sinal,
} from "./inteligencia-gestao";

/** Texto do "i" no canto de cada quadro que ainda não tinha explicação. */
export const EXPLICA_QUADRO = {
  comissaoPrevista:
    "Soma da sua parte de comissão nas vendas que ainda estão em andamento. A barra mostra quanto da meta de comissão do mês você já alcançou.",
  situacaoVendas:
    "Em que fase estão agora as vendas que você pode ver. A porcentagem conta só as vendas ativas; canceladas e arquivadas ficam de fora.",
  vendasRecentes:
    "As 8 vendas que mudaram por último. Toque em uma para abrir ou em “Ver todas” para a lista completa.",
  movimentacaoPeriodo:
    "O que aconteceu com as vendas dentro do período escolhido. Cada venda aparece em um quadro só, conforme onde ela terminou no período.",
  oQueFazerHoje:
    "Tudo o que está pendente com você agora, do mais urgente para o menos urgente. Toque em “Abrir” para resolver cada item.",
  meuTermometro:
    "Cinco sinais do seu trabalho: vendas, atividade da semana, leads, gestões e captações. É o mesmo retrato que sua gestão vê, sem ranking.",
  minhaProxima1a1:
    "Data da sua próxima conversa individual com a gestão e o que ficou combinado na última. Quem marca a data é a gestão.",
} as const;

/** Explicação da cor geral do termômetro (mesma regra de farolGeral). */
export const EXPLICA_FAROL: Record<Farol, string> = {
  novo: `Você está há menos de ${DIAS_NOVO} dias na equipe, por isso ainda não há cor de produção.`,
  tranquilo: "Nenhum sinal vermelho e no máximo um amarelo.",
  atencao: "Um sinal vermelho, ou dois ou mais amarelos. Vale olhar os sinais abaixo.",
  risco: "Dois ou mais sinais vermelhos. Comece pelos itens em vermelho abaixo.",
};

const EXPLICA_SINAL: Record<ChaveSinal, string> = {
  sem_vender:
    "Dias desde a sua última venda. Até 14 dias fica verde, de 15 a 30 amarelo, e acima de 30 dias (ou sem nenhuma venda ainda) vermelho.",
  atividade:
    "Quanto você já fez das ligações, V1, V2 e ACM da semana, comparado à meta do seu plano. 100% ou mais fica verde, de 70% a 99% amarelo, abaixo de 70% vermelho.",
  leads:
    "Leads que estão com você e têm prazo de resposta. Vermelho: algum prazo já venceu. Amarelo: algum vence em até 24 horas. Verde: tudo em dia.",
  gestoes: `Prazos das suas captações exclusivas: fim da exclusividade e reunião de 45 dias com o proprietário. Vermelho: algo já venceu. Amarelo: vence em até ${GESTAO_AVISO_DIAS} dias. Verde: tudo em dia.`,
  captacoes:
    "Captações assinadas neste mês, comparadas com o que a meta do mês do seu plano esperava até hoje. Chegou no esperado fica verde, 70% ou mais amarelo, abaixo disso vermelho.",
};

const SEM_PLANO =
  "Você ainda não tem um plano de metas, então não há meta para comparar. Quando o plano for preenchido, este sinal passa a aparecer com cor.";

const AGUARDANDO =
  "O Meu Plano 2027 já está preenchido, mas as metas só passam a contar em janeiro de 2027. Até lá este sinal fica sem cor.";

const SEM_DADO: Partial<Record<ChaveSinal, string>> = {
  leads: "Sua imobiliária não usa a área de leads do sistema, por isso este sinal não conta.",
  gestoes:
    "Sua imobiliária não usa a captação exclusiva do sistema, por isso este sinal não conta.",
};

/** Explicação de um selo do termômetro, conforme o sinal e o estado dele. */
export function explicaSinal(s: Pick<Sinal, "chave" | "cor">): string {
  if (s.cor === "sem_plano") return SEM_PLANO;
  if (s.cor === "aguardando") return AGUARDANDO;
  if (s.cor === "sem_dado") return SEM_DADO[s.chave] ?? EXPLICA_SINAL[s.chave];
  return EXPLICA_SINAL[s.chave];
}
