/**
 * Textos do ícone "i" dos 3 painéis de metas 2027 (cartão t_065a0ff9, pedido de Denis 20/11, tópico 6238).
 * TODOS os textos ficam aqui, para revisão num lugar só. Cada texto tem no máximo 2 frases:
 * (1) o que o número é; (2) de onde vem e qual período cobre.
 *
 * Escritos a partir do código real (não mudam regra nenhuma):
 * - regra.ts / realizado.ts / consolidado.ts / painel-*.ts (meta = meta oficial GRAVADA no botão verde, ritmo, farol, falta);
 * - RPCs: meu_realizado e minha_comissao_vendas (corretor), metas_equipe_planos e metas_equipe_realizado
 *   (equipes e imobiliária), metas_comissao_quebra e metas_imobiliaria_estoque (imobiliária), tabela metas_direcao.
 * Comissão do realizado = soma de occurrence_commissions de cada pessoa com cadastro (a parte dela, não a bruta),
 * nas vendas válidas pela data de ASSINATURA (dia de São Paulo). Por isso inclui repasse de líder e de indicação
 * recebidos pela própria pessoa. VGV = vgv_proprio da venda (sem parceria externa), 1 vez por venda.
 *
 * `ano` = ano dos números de realizado (antes de jan/2027 é o ano corrente; depois, 2027).
 * `anoPlano` = ano das metas (ANO_PLANO = 2027).
 */
export type Explicacao = { titulo: string; texto: string };
export type ContextoExplicacao = { ano: number; anoPlano: number };

type Gerador = (c: ContextoExplicacao) => Explicacao;
const e = (titulo: string, texto: string): Explicacao => ({ titulo, texto });

const FAROL_FAIXAS = "🟢 100% ou mais, 🟡 de 80% a 99%, 🔴 abaixo de 80%";

export const EXPLICACOES = {
  // ---------------------------------------------------------------------------------------------------------
  // Painel do CORRETOR ("Meu painel de metas 2027")
  // ---------------------------------------------------------------------------------------------------------
  corretor_farol: ({ anoPlano }) =>
    e(
      "Farol da meta",
      `Compara a sua comissão no ano com o que o seu plano previa até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem meta oficial e até 1º de janeiro de ${anoPlano}.`,
    ),
  corretor_meta_ano_antes: ({ anoPlano }) =>
    e(
      `Sua meta de ${anoPlano}`,
      `É a meta de comissão do ano gravada no seu Meu Plano ${anoPlano} (em "Usar como minha meta oficial" ou na assinatura). Começa a contar em 1º de janeiro de ${anoPlano}.`,
    ),
  corretor_antes_comissao_mes: () =>
    e(
      "Comissão no mês",
      "Sua parte da comissão (o que é seu, não a bruta) nas vendas com contrato assinado neste mês. Vem das vendas cadastradas no sistema, pela data da assinatura, na mesma regra dos relatórios.",
    ),
  corretor_antes_vendas_mes: () =>
    e(
      "Vendas no mês",
      "Quantas vendas com contrato assinado neste mês têm comissão para você: cada venda conta 1, mesmo se você captou e vendeu. Vem das vendas cadastradas no sistema, pela data da assinatura.",
    ),
  corretor_antes_comissao_ano: ({ ano }) =>
    e(
      "Comissão no ano",
      `Sua parte da comissão (o que é seu, não a bruta) nas vendas com contrato assinado em ${ano}, de 1º de janeiro até hoje. Vem das vendas cadastradas no sistema, na mesma regra dos relatórios.`,
    ),
  corretor_antes_vendas_ano: ({ ano }) =>
    e(
      "Vendas no ano",
      `Quantas vendas com contrato assinado em ${ano} têm comissão para você: cada venda conta 1, mesmo se você captou e vendeu. É de ${ano}, ainda não conta para a meta.`,
    ),
  corretor_barra_ano: ({ anoPlano }) =>
    e(
      `Meta do ano ${anoPlano}`,
      `O número grande é a sua comissão nas vendas assinadas desde 1º de janeiro de ${anoPlano} e o "de" é a meta de comissão do ano da sua meta oficial. O risco preto na barra marca onde você deveria estar hoje.`,
    ),
  corretor_ritmo: () =>
    e(
      "À frente / atrás",
      'Diferença entre a comissão que você já fez no ano e o que deveria ter feito até hoje. O "deveria" soma as metas dos meses que passaram, conforme a distribuição do seu plano, mais a parte do mês atual pelos dias corridos.',
    ),
  corretor_barra_mes: () =>
    e(
      "Meta do mês",
      'O número grande é a sua comissão nas vendas assinadas neste mês e o "de" é a meta deste mês na distribuição que você fez no plano. Mês que você não preencheu usa a sugestão do próprio plano (meta do ano ÷ 12).',
    ),
  corretor_falta_mes: () =>
    e(
      "Falta no mês / por semana",
      'Quanto falta para a meta de comissão deste mês: meta do mês menos o que já entrou. O "por semana" divide esse valor pelas semanas que restam no mês, contando a semana de hoje.',
    ),
  corretor_comissao_ano: ({ ano }) =>
    e(
      "Comissão no ano",
      `Sua parte da comissão (o que é seu, não a bruta) nas vendas com contrato assinado em ${ano}, de 1º de janeiro até hoje. Não aparece meta porque você ainda não gravou a meta oficial nem assinou o plano.`,
    ),
  corretor_comissao_mes: () =>
    e(
      "Comissão no mês",
      "Sua parte da comissão nas vendas com contrato assinado neste mês. Não aparece meta porque você ainda não gravou a meta oficial nem assinou o plano.",
    ),
  corretor_vendas_ano: ({ ano }) =>
    e(
      "Vendas no ano",
      `Seus lados de venda em ${ano}, nas vendas com contrato assinado: captou conta 1, vendeu conta 1 (as duas na mesma venda = 2). A meta, quando há meta oficial, é a de transações do plano, na mesma unidade.`,
    ),
  corretor_captacoes_ano: ({ ano }) =>
    e(
      "Captações no ano",
      `Suas captações exclusivas aprovadas em ${ano}, contadas para o captador original na data da aprovação. A meta, quando há meta oficial, é a de novas captações do plano.`,
    ),
  corretor_vgv_ano: ({ ano }) =>
    e(
      "VGV no ano",
      `Soma do valor das vendas assinadas em ${ano} em que você participa (VGV próprio, sem a parte de parceria externa), cada venda uma vez e inteira. A meta é a de VGV do plano: transações ÷ 2 × ticket médio.`,
    ),
  corretor_sua_parte: () =>
    e(
      "Sua parte",
      "O que é seu nesta venda, já sem o indicador e os extras descontados do seu lado. Vem da distribuição da comissão cadastrada na venda; você não vê a bruta nem a parte da imobiliária.",
    ),
  corretor_descontado: () =>
    e(
      "Descontado de você",
      "Indicador e extras que saíram do seu lado (captador e/ou vendedor) nesta venda. Vem da mesma distribuição da comissão cadastrada na venda.",
    ),
  corretor_total_ano: ({ ano }) =>
    e(
      "Sua comissão no ano",
      `Soma da sua parte em todas as vendas da lista acima, assinadas em ${ano}. O descontado é a soma do indicador e dos extras tirados do seu lado nessas vendas.`,
    ),

  // ---------------------------------------------------------------------------------------------------------
  // Painel das EQUIPES (/painel-metas): resumo do total, cartão de cada equipe e cartão de cada corretor
  // ---------------------------------------------------------------------------------------------------------
  equipe_farol: () =>
    e(
      "Farol da equipe",
      `Compara a comissão de quem conta na meta com o que a soma das metas oficiais previa até hoje: ${FAROL_FAIXAS}. Quem não conta fica fora; sem nenhuma meta oficial fica ⚪, e antes de janeiro o farol não aparece.`,
    ),
  equipe_meta_assinados: ({ anoPlano }) =>
    e(
      `Meta ${anoPlano} (metas oficiais)`,
      `Soma das metas oficiais gravadas pelos corretores desta equipe (botão verde "Usar como minha meta oficial" ou assinatura), mesmo sem assinar, com o valor gravado. É comparada só com o realizado dessas pessoas; meta fora do limite e plano sem meta gravada não entram.`,
    ),
  equipe_comissao_ano: ({ ano, anoPlano }) =>
    e(
      "Comissão",
      ano < anoPlano
        ? `Comissão ${ano} = parte de comissão (não a bruta) de quem conta na meta, nas vendas assinadas em ${ano}; meta ${anoPlano} = soma das metas oficiais dessas pessoas. São anos diferentes, por isso não há barra, % nem farol até janeiro.`
        : `Parte de comissão (não a bruta) de quem conta na meta, nas vendas assinadas em ${ano}, de 1º de janeiro até hoje. A produção de quem não conta aparece à parte, embaixo.`,
    ),
  equipe_barra_ano: () =>
    e(
      "Meta do ano (metas oficiais)",
      'O número grande é a comissão SÓ de quem conta na meta nas vendas assinadas desde 1º de janeiro (o ano inteiro), e o "de" é a soma das metas oficiais dessas pessoas. A produção de quem não conta aparece à parte e não entra aqui.',
    ),
  equipe_ritmo: () =>
    e(
      "Ritmo da equipe",
      "Diferença entre a comissão de quem conta na meta e o que a soma das metas oficiais previa até hoje (meses que passaram mais a parte do mês atual pelos dias corridos). O % entre parênteses é esse realizado dividido pelo esperado.",
    ),
  equipe_barra_mes: () =>
    e(
      "Meta do mês",
      'Comissão de quem conta na meta nas vendas assinadas neste mês contra a soma das metas deste mês dessas pessoas. O "falta" é a meta do mês menos esse realizado.',
    ),
  equipe_vendas: ({ ano, anoPlano }) =>
    e(
      "Vendas",
      `Realizado de ${ano} = lados de venda só de quem conta na meta (captou = 1, vendeu = 1), nas vendas com contrato assinado. Meta = transações de ${anoPlano} somadas das metas oficiais${ano < anoPlano ? "; até janeiro os dois aparecem separados, sem %" : ""}.`,
    ),
  equipe_captacoes: ({ ano, anoPlano }) =>
    e(
      "Captações",
      `Realizado de ${ano} = captações exclusivas aprovadas só de quem conta na meta, para o captador original na data da aprovação. Meta = novas captações de ${anoPlano} somadas das metas oficiais.`,
    ),
  equipe_vgv: ({ ano }) =>
    e(
      "VGV",
      `Valor das vendas assinadas em ${ano} com alguém que conta na meta (VGV próprio, sem parceria externa). Venda dividida conta 1 vez, inteira: se um lado conta e o outro não, fica aqui e não na produção de quem não conta.`,
    ),
  equipe_nao_assinados: ({ ano }) =>
    e(
      "Produção de quem não conta na meta",
      `Comissão, lados de venda e VGV de ${ano} das pessoas desta equipe sem meta oficial e sem plano assinado, e quantas delas produziram. Só informa: não entra na meta, no %, no ritmo nem no farol.`,
    ),
  equipe_planos_assinados: ({ anoPlano }) =>
    e(
      "Planos assinados",
      `Quantas pessoas da equipe estão com o Meu Plano ${anoPlano} assinado agora (plano reaberto sai na hora), de quantas deveriam (corretores ativos + gestores/TLs que vendem); quem só gravou a meta oficial já conta na meta, mas falta assinar. Gestor/TL "vende" se tem plano ou teve venda ou captação nos últimos 12 meses.`,
    ),
  equipe_preenchimento: () =>
    e(
      "Em preenchimento",
      "Planos começados sem meta oficial gravada no botão verde (inclusive os reabertos) e a soma das metas de comissão calculadas deles, sem os planos com valor acima do limite de bloqueio (ficam à parte, a conferir). Só informa: não entra na meta oficial nem no farol.",
    ),
  equipe_parados: () =>
    e(
      "Há mais tempo sem vender ou captar",
      "Dias desde a última venda assinada (como captador ou vendedor) e desde a última captação aprovada, olhando os últimos 12 meses. Mostra até 5 pessoas paradas há mais de 14 dias.",
    ),
  pessoa_farol: ({ anoPlano }) =>
    e(
      "Farol do corretor",
      `Compara a comissão do corretor no ano com o que a meta oficial dele previa até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem meta oficial e até 1º de janeiro de ${anoPlano}.`,
    ),
  pessoa_plano: ({ anoPlano }) =>
    e(
      "Situação do plano",
      `Assinado = o corretor assinou o Meu Plano ${anoPlano}; em preenchimento = começou e não assinou, ou o plano foi reaberto pelo gestor/líder; sem plano = nem começou. Conta na meta só quem tem meta oficial gravada (botão verde ou assinatura), mesmo sem assinar; "Reabrir plano" desfaz a assinatura e a meta oficial, sem apagar valores.`,
    ),
  pessoa_ano: () =>
    e(
      "Ano: realizado de meta",
      "Parte do corretor na comissão das vendas assinadas desde 1º de janeiro, contra a meta de comissão do ano da meta oficial dele. O risco preto na barra marca onde ele deveria estar hoje.",
    ),
  pessoa_falta: () =>
    e(
      "Falta no mês / no ano",
      "Quanto falta para a meta de comissão deste mês e do ano da meta oficial. É a meta menos o que já entrou (nunca fica negativo).",
    ),
  pessoa_meta_antes: ({ ano, anoPlano }) =>
    e(
      `Meta ${anoPlano} · comissão em ${ano}`,
      `A meta é a de comissão do ano da meta oficial ${anoPlano} do corretor. A comissão é a parte dele nas vendas assinadas em ${ano}, de 1º de janeiro até hoje, e ainda não conta para a meta.`,
    ),
  pessoa_sem_meta: ({ ano }) =>
    e(
      "Comissão no ano",
      `Parte do corretor na comissão das vendas assinadas em ${ano}, de 1º de janeiro até hoje. Não há meta porque ele não tem meta oficial gravada (ou ela está fora do limite).`,
    ),
  pessoa_vendas_captacoes: ({ ano }) =>
    e(
      "Vendas e captações no ano",
      `Vendas = lados do corretor nas vendas assinadas em ${ano} (captou = 1, vendeu = 1). Captações = captações exclusivas aprovadas em ${ano}, contadas para o captador original.`,
    ),

  // ---------------------------------------------------------------------------------------------------------
  // Painel da IMOBILIÁRIA (/painel-metas-imobiliaria)
  // ---------------------------------------------------------------------------------------------------------
  imob_meta_direcao: ({ anoPlano }) =>
    e(
      `Meta da direção ${anoPlano}`,
      'Meta de comissão do ano digitada pelo administrador em "Editar meta da direção". É o alvo da direção e não vem dos planos dos corretores.',
    ),
  imob_soma_assinados: ({ anoPlano }) =>
    e(
      "Soma das metas oficiais",
      `Meta oficial = soma das metas ${anoPlano} gravadas pelos corretores ativos no botão verde "Usar como minha meta oficial" (ou na assinatura), já no clique, mesmo sem assinar. Usa o valor gravado; meta fora do limite fica à parte e não entra.`,
    ),
  imob_preenchimento: () =>
    e(
      "Sem meta oficial (não conta)",
      "Soma das metas de comissão calculadas nos planos começados que ainda não têm meta oficial gravada no botão verde, sem os planos com valor acima do limite de bloqueio (comissão acima de R$ 5 mi, mais de 1.000 transações ou mais de 500 captações), que aparecem à parte, a conferir. Só informa: não entra na meta oficial.",
    ),
  preenchimento_a_conferir: () =>
    e(
      "Planos sem meta oficial a conferir",
      'Planos sem meta oficial gravada cuja meta calculada passa do limite de bloqueio (comissão acima de R$ 5 mi, mais de 1.000 transações ou mais de 500 captações), quase sempre por erro de digitação. Ficam fora da soma "Sem meta oficial" até o corretor corrigir o plano.',
    ),
  imob_diferenca: () =>
    e(
      "Diferença para a direção",
      "Soma das metas oficiais menos a meta da direção; o % é metas oficiais ÷ direção. Negativo quer dizer que faltam metas oficiais para chegar no que a direção quer.",
    ),
  imob_tabela_direcao: () =>
    e(
      "Indicadores do ano",
      "Para comissão, VGV, vendas (transações) e captações: meta da direção, soma das metas oficiais e a diferença entre elas. A meta da direção é só do ano, sem mês a mês.",
    ),
  imob_realizado: ({ ano, anoPlano }) =>
    e(
      "Realizado de quem conta na meta × meta oficial",
      `Parte de comissão (não a bruta) de quem conta na meta ${anoPlano}, nas vendas assinadas em ${ano}, comparada com a meta oficial (soma dessas metas). A produção de quem não conta e a imobiliária inteira × meta da direção aparecem logo abaixo, separadas.`,
    ),
  imob_nao_assinados: ({ ano }) =>
    e(
      "Produção de quem não conta na meta",
      `Comissão de ${ano} de quem não tem meta oficial nem plano assinado, incluindo quem já saiu da imobiliária e repasses a pessoas com cadastro. Não entra na meta oficial nem no farol.`,
    ),
  imob_realizado_casa: ({ ano, anoPlano }) =>
    e(
      "Imobiliária inteira × meta da direção",
      `Comissão de ${ano} da imobiliária INTEIRA (quem conta na meta, quem não conta e quem já saiu), porque a meta da direção vale para a casa toda. O % só aparece a partir de janeiro de ${anoPlano}.`,
    ),
  imob_ritmo: ({ anoPlano }) =>
    e(
      "Ritmo esperado até hoje",
      `Diferença entre a comissão de quem conta na meta e o que a soma das metas oficiais previa até hoje (meses que passaram mais a parte do mês atual pelos dias corridos). Começa a contar em janeiro de ${anoPlano}.`,
    ),
  imob_cobertura: ({ anoPlano }) =>
    e(
      "Cobertura de planos assinados",
      `Quantas pessoas já assinaram o pacto do Meu Plano ${anoPlano}, de quantas deveriam ter (corretores ativos + gestores/Team Leaders que vendem). É separado da meta: quem só gravou a meta oficial já conta na meta, mas ainda falta assinar.`,
    ),
  imob_grafico: ({ ano }) =>
    e(
      "Mês a mês",
      `Barra cinza = soma das metas do mês das metas oficiais; barra azul = comissão do mês só de quem conta na meta (vendas assinadas em ${ano}). Fica verde quando o mês bateu a meta.`,
    ),
  imob_vgv: ({ ano }) =>
    e(
      "VGV",
      `Soma do valor das vendas assinadas em ${ano} na imobiliária inteira, com ou sem meta oficial (VGV próprio, sem parceria externa). Venda dividida entre dois corretores conta 1 vez, com o valor inteiro.`,
    ),
  imob_vendas: ({ ano }) =>
    e(
      "Vendas (lados)",
      `Lados de venda em ${ano}: cada venda assinada conta 1 para o captador e 1 para o vendedor (até 2 por venda). É a mesma unidade da meta de transações dos planos.`,
    ),
  imob_captacoes: ({ ano }) =>
    e(
      "Captações",
      `Captações exclusivas aprovadas em ${ano} na imobiliária, contadas na data da aprovação. Cada captação conta 1 vez.`,
    ),
  imob_estoque: () =>
    e(
      "Estoque hoje",
      "Exclusivas ativas = captações aprovadas que não foram arquivadas nem descartadas, hoje. Novas em 30 dias = aprovadas nos últimos 30 dias; anúncios no XML = imóveis da última leitura boa do XML RE/MAX.",
    ),
  imob_quebra_bruta: ({ ano }) =>
    e(
      "Bruta",
      `Comissão total das vendas assinadas em ${ano}, antes de qualquer divisão (no lançamento, inclui o prêmio). Vem da distribuição da comissão cadastrada em cada venda.`,
    ),
  imob_quebra_imobiliaria: () =>
    e(
      "(−) Imobiliária",
      "O que fica com a imobiliária em cada venda (saldo líquido da casa), somado no ano. Vem da distribuição da comissão cadastrada em cada venda.",
    ),
  imob_quebra_lideres: () =>
    e(
      "(−) Gestores/TL",
      "Repasse para gestores e Team Leaders nas vendas do ano. No lançamento, inclui a divisão com papel de gestor ou Team Leader.",
    ),
  imob_quebra_indicador: () =>
    e(
      "(−) Indicador",
      "Comissão de quem indicou, do lado do captador e do lado do vendedor, somada nas vendas do ano. Vem da distribuição da comissão cadastrada em cada venda.",
    ),
  imob_quebra_parceria: () =>
    e(
      "(−) Parceria e extras",
      "Parceria externa (inclui quem não tem cadastro no sistema) mais os outros extras e as comissões manuais. Corretor que divide a captação ou a venda não entra aqui: vai para os corretores.",
    ),
  imob_quebra_corretores: () =>
    e(
      "= Líquido dos corretores",
      'O que sobra para os corretores: líquido do captador e do vendedor, mais outros corretores da divisão. Pode ser menor que o "Realizado no ano", que também soma repasses de líder e indicação a pessoas com cadastro.',
    ),
  imob_ranking_equipes: ({ ano }) =>
    e(
      "Ranking por equipe",
      `Equipes ordenadas pelo % do esperado até hoje: comissão de quem conta na meta ÷ o que as metas oficiais previam. Mostra essa comissão de ${ano}, a meta oficial somada e quantos planos foram assinados.`,
    ),
  imob_ranking_corretores: ({ ano }) =>
    e(
      "Ranking por corretor",
      `Corretores ordenados pelo % do esperado até hoje: comissão dele ÷ o que a meta oficial previa. Mostra a parte dele na comissão de ${ano} e a meta oficial (sem meta oficial, fica sem meta).`,
    ),
  imob_farol: ({ anoPlano }) =>
    e(
      "Farol",
      `Compara a comissão de quem conta na meta com o que as metas oficiais previam até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem meta oficial e até 1º de janeiro de ${anoPlano}.`,
    ),
  // "Plano com valor a conferir" (t_125c4dd3): mesma regra nos 3 painéis (src/lib/meu-plano-2027/conferencia.ts).
  plano_a_conferir: () =>
    e(
      "Plano com valor a conferir",
      "O plano tem número fora do comum: transações acima de 150 por ano (ou com ponto/vírgula), ticket abaixo de R$ 50 mil ou acima de R$ 10 mi, comissão por transação abaixo de R$ 1.000 ou fora de 1% a 10%, ou meta acima de R$ 1 mi. Só marca para revisar: o plano continua na soma e no farol como está.",
    ),
  meta_gravada_a_conferir: () =>
    e(
      "Meta gravada a conferir",
      "Meta oficial gravada acima do limite de bloqueio: comissão do ano acima de R$ 5 mi, mais de 1.000 transações ou mais de 500 captações. Fica FORA da soma oficial e do farol até o corretor corrigir o plano e gravar de novo.",
    ),
  corretor_a_conferir: () =>
    e(
      "Seu plano tem valor a conferir",
      "Algum número do seu Meu Plano 2027 está fora do comum e pode ser erro de digitação (ex.: transações digitadas como valor em reais). A meta abaixo continua sendo a do seu plano; corrija no plano se for erro.",
    ),
} satisfies Record<string, Gerador>;

export type ChaveExplicacao = keyof typeof EXPLICACOES;

export function explicacao(chave: ChaveExplicacao, c: ContextoExplicacao): Explicacao {
  return EXPLICACOES[chave](c);
}

/** Todas as explicações (para revisão e testes). */
export function todasExplicacoes(c: ContextoExplicacao): [ChaveExplicacao, Explicacao][] {
  return (Object.keys(EXPLICACOES) as ChaveExplicacao[]).map((k) => [k, EXPLICACOES[k](c)]);
}
