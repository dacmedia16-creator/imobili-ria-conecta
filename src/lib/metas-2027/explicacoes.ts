/**
 * Textos do ícone "i" dos 3 painéis de metas 2027 (cartão t_065a0ff9, pedido de Denis 20/11, tópico 6238).
 * TODOS os textos ficam aqui, para revisão num lugar só. Cada texto tem no máximo 2 frases:
 * (1) o que o número é; (2) de onde vem e qual período cobre.
 *
 * Escritos a partir do código real (não mudam regra nenhuma):
 * - regra.ts / realizado.ts / consolidado.ts / painel-*.ts (meta só do plano ASSINADO, ritmo, farol, falta);
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
      `Compara a sua comissão no ano com o que o seu plano previa até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem plano assinado e até 1º de janeiro de ${anoPlano}.`,
    ),
  corretor_meta_ano_antes: ({ anoPlano }) =>
    e(
      `Sua meta de ${anoPlano}`,
      `É a meta de comissão do ano do seu Meu Plano ${anoPlano} assinado, a mesma gravada na assinatura. Começa a contar em 1º de janeiro de ${anoPlano}.`,
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
      `O número grande é a sua comissão nas vendas assinadas desde 1º de janeiro de ${anoPlano} e o "de" é a meta de comissão do ano do seu plano assinado. O risco preto na barra marca onde você deveria estar hoje.`,
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
      `Sua parte da comissão (o que é seu, não a bruta) nas vendas com contrato assinado em ${ano}, de 1º de janeiro até hoje. Não aparece meta porque o seu plano ainda não foi assinado.`,
    ),
  corretor_comissao_mes: () =>
    e(
      "Comissão no mês",
      "Sua parte da comissão nas vendas com contrato assinado neste mês. Não aparece meta porque o seu plano ainda não foi assinado.",
    ),
  corretor_vendas_ano: ({ ano }) =>
    e(
      "Vendas no ano",
      `Seus lados de venda em ${ano}, nas vendas com contrato assinado: captou conta 1, vendeu conta 1 (as duas na mesma venda = 2). A meta, quando há plano assinado, é a de transações do plano, na mesma unidade.`,
    ),
  corretor_captacoes_ano: ({ ano }) =>
    e(
      "Captações no ano",
      `Suas captações exclusivas aprovadas em ${ano}, contadas para o captador original na data da aprovação. A meta, quando há plano assinado, é a de novas captações do plano.`,
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
  equipe_farol: ({ anoPlano }) =>
    e(
      "Farol da equipe",
      `Compara a comissão da equipe no ano com o que a soma dos planos assinados previa até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem nenhum plano assinado e até 1º de janeiro de ${anoPlano}.`,
    ),
  equipe_meta_assinados: ({ anoPlano }) =>
    e(
      `Meta ${anoPlano} (assinados)`,
      `Soma das metas de comissão do ano dos planos ${anoPlano} já ASSINADOS pelas pessoas desta equipe; planos em preenchimento e quem está sem plano não entram. Pode vir de poucas pessoas: veja "Planos assinados" logo abaixo.`,
    ),
  equipe_comissao_ano: ({ ano, anoPlano }) =>
    e(
      `Comissão em ${ano}`,
      `Soma da parte de comissão de TODAS as pessoas que estão hoje na equipe, com ou sem plano assinado (não é a bruta; inclui repasse de líder e de indicação recebido por elas). Vem das vendas com contrato assinado em ${ano}, de 1º de janeiro até hoje${ano < anoPlano ? `, então ainda não é o realizado da meta ${anoPlano}` : ""}.`,
    ),
  equipe_barra_ano: () =>
    e(
      "Meta do ano (planos assinados)",
      'O número grande é a comissão de todas as pessoas da equipe nas vendas assinadas desde 1º de janeiro, e o "de" é a soma das metas do ano só dos planos assinados. Quem não assinou o plano entra no realizado, mas não na meta.',
    ),
  equipe_ritmo: () =>
    e(
      "Ritmo da equipe",
      "Diferença entre a comissão da equipe no ano e o que a soma dos planos assinados previa até hoje (meses que passaram mais a parte do mês atual pelos dias corridos). O % entre parênteses é o realizado dividido por esse esperado.",
    ),
  equipe_barra_mes: () =>
    e(
      "Meta do mês",
      'Comissão da equipe nas vendas assinadas neste mês contra a soma das metas deste mês dos planos assinados (distribuição mês a mês de cada plano). O "falta" é a meta do mês menos o realizado do mês.',
    ),
  equipe_vendas: ({ ano, anoPlano }) =>
    e(
      "Vendas (realizado / meta)",
      `O 1º número é o realizado de ${ano}: lados de venda de todas as pessoas da equipe nas vendas com contrato assinado (captou = 1, vendeu = 1). O 2º é a meta de transações de ${anoPlano}, somada só dos planos assinados.`,
    ),
  equipe_captacoes: ({ ano, anoPlano }) =>
    e(
      "Captações (realizado / meta)",
      `O 1º número é o realizado de ${ano}: captações exclusivas aprovadas das pessoas da equipe, contadas para o captador original na data da aprovação. O 2º é a meta de novas captações de ${anoPlano}, somada só dos planos assinados.`,
    ),
  equipe_vgv: ({ ano }) =>
    e(
      "VGV",
      `Soma do valor das vendas assinadas em ${ano} com alguém da equipe (VGV próprio, sem parceria externa). Venda dividida entre duas pessoas da equipe conta 1 vez, com o valor inteiro.`,
    ),
  equipe_planos_assinados: ({ anoPlano }) =>
    e(
      "Planos assinados",
      `Quantas pessoas da equipe já assinaram o Meu Plano ${anoPlano}, de quantas deveriam ter plano (corretores ativos + gestores/Team Leaders que vendem). Gestor/TL "vende" se tem plano ou teve venda ou captação nos últimos 12 meses.`,
    ),
  equipe_preenchimento: () =>
    e(
      "Em preenchimento",
      "Planos começados e ainda não assinados, e a soma das metas de comissão deles. Só informa: não entra na meta oficial nem no farol.",
    ),
  equipe_parados: () =>
    e(
      "Há mais tempo sem vender ou captar",
      "Dias desde a última venda assinada (como captador ou vendedor) e desde a última captação aprovada, olhando os últimos 12 meses. Mostra até 5 pessoas paradas há mais de 14 dias.",
    ),
  pessoa_farol: ({ anoPlano }) =>
    e(
      "Farol do corretor",
      `Compara a comissão do corretor no ano com o que o plano assinado dele previa até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem plano assinado e até 1º de janeiro de ${anoPlano}.`,
    ),
  pessoa_plano: ({ anoPlano }) =>
    e(
      "Situação do plano",
      `Assinado = o corretor assinou o Meu Plano ${anoPlano}; em preenchimento = começou e não assinou; sem plano = nem começou. Só o plano assinado vale como meta.`,
    ),
  pessoa_ano: () =>
    e(
      "Ano: realizado de meta",
      "Parte do corretor na comissão das vendas assinadas desde 1º de janeiro, contra a meta de comissão do ano do plano assinado dele. O risco preto na barra marca onde ele deveria estar hoje.",
    ),
  pessoa_falta: () =>
    e(
      "Falta no mês / no ano",
      "Quanto falta para a meta de comissão deste mês e do ano do plano assinado. É a meta menos o que já entrou (nunca fica negativo).",
    ),
  pessoa_meta_antes: ({ ano, anoPlano }) =>
    e(
      `Meta ${anoPlano} · comissão em ${ano}`,
      `A meta é a de comissão do ano do plano ${anoPlano} assinado pelo corretor. A comissão é a parte dele nas vendas assinadas em ${ano}, de 1º de janeiro até hoje, e ainda não conta para a meta.`,
    ),
  pessoa_sem_meta: ({ ano }) =>
    e(
      "Comissão no ano",
      `Parte do corretor na comissão das vendas assinadas em ${ano}, de 1º de janeiro até hoje. Não há meta porque o plano dele não está assinado.`,
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
      "Soma dos planos assinados (oficial)",
      `Soma das metas de comissão do ano de todos os planos ${anoPlano} já assinados por quem está ativo na imobiliária. É a meta oficial usada no farol, no ritmo e no gráfico.`,
    ),
  imob_preenchimento: () =>
    e(
      "Em preenchimento (não conta)",
      "Soma das metas de comissão dos planos começados e ainda não assinados. Só informa: não entra na meta oficial.",
    ),
  imob_diferenca: () =>
    e(
      "Diferença para a direção",
      "Soma dos planos assinados menos a meta da direção; o % é assinados ÷ direção. Negativo quer dizer que faltam planos assinados para chegar no que a direção quer.",
    ),
  imob_tabela_direcao: () =>
    e(
      "Indicadores do ano",
      "Para comissão, VGV, vendas (transações) e captações: meta da direção, soma dos planos assinados e a diferença entre elas. A meta da direção é só do ano, sem mês a mês.",
    ),
  imob_realizado: ({ ano }) =>
    e(
      "Realizado no ano",
      `Soma da parte de comissão de cada pessoa (não a bruta) nas vendas assinadas em ${ano}, na imobiliária inteira, incluindo quem já saiu e repasses de líder e indicação a pessoas com cadastro. O 1º % compara com a meta oficial (planos assinados) e o 2º com a meta da direção.`,
    ),
  imob_ritmo: ({ anoPlano }) =>
    e(
      "Ritmo esperado até hoje",
      `Diferença entre o realizado do ano e o que a soma dos planos assinados previa até hoje (meses que passaram mais a parte do mês atual pelos dias corridos). Começa a contar em janeiro de ${anoPlano}.`,
    ),
  imob_cobertura: ({ anoPlano }) =>
    e(
      "Cobertura de planos assinados",
      `Quantas pessoas já assinaram o Meu Plano ${anoPlano}, de quantas deveriam ter (corretores ativos + gestores/Team Leaders que vendem). Preenchendo = começou e não assinou; sem plano = nem começou.`,
    ),
  imob_grafico: ({ ano }) =>
    e(
      "Mês a mês",
      `Barra cinza = soma das metas do mês dos planos assinados; barra azul = comissão do mês (parte de cada pessoa, vendas assinadas em ${ano}). Fica verde quando o mês bateu a meta.`,
    ),
  imob_vgv: ({ ano }) =>
    e(
      "VGV",
      `Soma do valor das vendas assinadas em ${ano} na imobiliária (VGV próprio, sem parceria externa). Venda dividida entre dois corretores conta 1 vez, com o valor inteiro.`,
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
      `Equipes ordenadas pelo % do esperado até hoje: comissão da equipe ÷ o que os planos assinados previam. Mostra a comissão de ${ano}, a meta somada dos planos assinados e quantos planos foram assinados.`,
    ),
  imob_ranking_corretores: ({ ano }) =>
    e(
      "Ranking por corretor",
      `Corretores ordenados pelo % do esperado até hoje: comissão dele ÷ o que o plano assinado previa. Mostra a parte dele na comissão de ${ano} e a meta do plano assinado (sem plano assinado, fica sem meta).`,
    ),
  imob_farol: ({ anoPlano }) =>
    e(
      "Farol",
      `Compara a comissão no ano com o que os planos assinados previam até hoje: ${FAROL_FAIXAS}. Fica ⚪ sem plano assinado e até 1º de janeiro de ${anoPlano}.`,
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
