-- Corrige dashboard_stats().comissao_por_corretor: somava occurrences.valor_comissao (comissão
-- BRUTA total da venda) agrupado por sales.corretor_id (quem CADASTROU a venda), atribuindo o valor
-- inteiro a essa pessoa mesmo quando a comissão é dividida entre vários beneficiários reais em
-- occurrence_commissions. Achado confirmado por auditoria: uma gestora que reporta vendas de
-- Lançamento pelo time aparecia com dezenas de milhares de reais de comissão que, na distribuição
-- real, pertenciam a outras pessoas — em alguns casos, R$ 0,00 do valor exibido era dela.
--
-- A correção espelha exatamente o padrão já correto de metas_progresso() (mesma auditoria confirmou
-- que aquela função nunca teve esse problema): agrupa por occurrence_commissions.user_id, a fonte
-- real de "quem recebe". Linhas sem user_id (sem vínculo de perfil) não entram — não há como somar
-- ao total de alguém sem saber quem é; ficam de fora do objeto, não em uma chave "null" ou "sem
-- cadastro" (o front-end decide como sinalizar isso, não este cálculo).
--
-- Segunda correção (mesma migration, mesma raiz): 'comissao_prevista_total' e
-- 'comissao_concluida_total' somavam occurrences.valor_comissao BRUTO, sem descontar a parte que
-- pertence a parceiro(s) externo(s) confirmado(s) (occurrence_commissions.sem_cadastro_confirmado —
-- ex.: Wilson Grecchi, corretor parceiro sem cadastro no sistema, que chega a levar 71% da comissão
-- de uma venda). Regra de negócio confirmada: dinheiro de parceria externa NUNCA é receita/resultado
-- estimado da imobiliária — só é dela o que sobra depois de descontar essa fatia. As duas chaves
-- continuam com o mesmo nome (nenhuma mudança de contrato pro front-end que já as lê), só passam a
-- vir líquidas. A fatia de parceria externa não desaparece: fica exposta à parte, em duas chaves
-- novas ('comissao_parceria_externa_prevista_total' / '..._concluida_total'), pra permitir um
-- controle separado dela sem ela contaminar nenhum indicador de faturamento.
--
-- Igual à 1ª correção: uma ocorrência sem nenhuma linha sem_cadastro_confirmado=true simplesmente não
-- aparece em parceria_por_occ (LEFT JOIN + COALESCE(...,0)) — comportamento idêntico ao de hoje.
--
-- Não muda estrutura, parâmetros nem nenhuma outra chave de dashboard_stats().
--
-- Renomeada de 20260817010000 para 20260817030000 (git mv, sem alterar o SQL abaixo): o corpo desta
-- função lê occurrence_commissions.sem_cadastro_confirmado, coluna criada só pela migration
-- 20260817020000_exige_confirmacao_sem_cadastro.sql — a numeração original (010000, antes de 020000)
-- faria esta migration falhar em produção por depender de uma coluna que ainda não existe. Renumerada
-- pra depois de 020000 pra a ordem natural do nome do arquivo já refletir a dependência real; nenhuma
-- linha executável foi alterada nesta correção, só este comentário foi adicionado.
create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from occurrence_commissions
    where sem_cadastro_confirmado
    group by occurrence_id
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from sales group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from sales where corretor_id = auth.uid()),
    'minhas_pendencias', (select count(*) from sales where corretor_id = auth.uid() and status::text in ('rascunho','devolvida_ajuste')),
    'meus_contratos_conferir', (select count(*) from sales where corretor_id = auth.uid() and status::text = 'contrato_conferencia_corretor'),
    'meus_assinados', (select count(*) from sales where corretor_id = auth.uid() and status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')),
    'minha_comissao_prevista', coalesce((select sum(valor_total_comissao) from sales where corretor_id = auth.uid() and status::text not in ('ocorrencia_concluida','arquivada','cancelada')), 0),
    'gestor_aguardando_revisao', (select count(*) from sales where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from sales where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from sales where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from sales where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from sales where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from sales where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from sales where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from sales where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from sales where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from sales where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join occurrences o on o.id = oc.occurrence_id
        join sales s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;
