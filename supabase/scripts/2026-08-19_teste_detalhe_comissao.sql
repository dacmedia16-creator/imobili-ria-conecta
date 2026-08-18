-- Script DESCARTÁVEL, só para o Supabase local. Testa visao_executiva_detalhe_comissao() nos 3
-- modos (corretor, equipe, sem equipe) e confirma que a soma de cada modo bate com o valor
-- correspondente em visao_executiva_stats() (ranking_corretor / ranking_equipe).

DO $$
DECLARE
  v_a uuid := '72915db6-7c2c-4760-81c6-cd68fb91e322'; -- corretor com 2 vendas, tem equipe
  v_b uuid := 'ba7526db-242e-4ded-ab80-a6f0992249e7';  -- corretor com 1 venda, mesma equipe de v_a
  v_c uuid := '200b4e33-27a4-49f2-bd1d-e4813f8f84cf';  -- corretor sem equipe (lancamento)
  v_sale1 uuid;
  v_sale2 uuid;
  v_sale3 uuid;
  v_sale4 uuid;
  v_occ1 uuid;
  v_occ2 uuid;
  v_occ3 uuid;
  v_occ4 uuid;
  v_team uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  UPDATE public.profiles SET nome='Detalhe Teste A', ativo=true WHERE id = v_a;
  UPDATE public.profiles SET nome='Detalhe Teste B', ativo=true WHERE id = v_b;
  UPDATE public.profiles SET nome='Detalhe Teste C', ativo=true WHERE id = v_c;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_a, 'corretor') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_a, 'gestor') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_b, 'corretor') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_c, 'lancamento') ON CONFLICT DO NOTHING;

  INSERT INTO public.teams (id, lider_id, nome) VALUES (v_team, v_a, 'Equipe Teste Detalhe')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES (v_b, v_team, 'corretor')
    ON CONFLICT (membro_id) DO UPDATE SET team_id = EXCLUDED.team_id;
  DELETE FROM public.team_members WHERE membro_id = v_c;

  DELETE FROM public.sales WHERE corretor_id IN (v_a, v_b, v_c);

  -- v_a: 2 vendas padrão, contrato_assinado dentro de 30 dias
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_a, 'contrato_assinado', 'padrao', 300000, 'TESTE-DETALHE-A1') RETURNING id INTO v_sale1;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale1, 'contrato_assinado', now() - interval '1 day');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale1, 300000, 15000, 'concluida') RETURNING id INTO v_occ1;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ1, 'corretor_vendedor', 'Detalhe Teste A', v_a, 15000);

  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_a, 'contrato_assinado', 'padrao', 200000, 'TESTE-DETALHE-A2') RETURNING id INTO v_sale2;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale2, 'contrato_assinado', now() - interval '3 day');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale2, 200000, 10000, 'concluida') RETURNING id INTO v_occ2;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ2, 'corretor_vendedor', 'Detalhe Teste A', v_a, 10000);

  -- v_b: 1 venda padrão (mesma equipe de v_a)
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_b, 'contrato_assinado', 'padrao', 150000, 'TESTE-DETALHE-B1') RETURNING id INTO v_sale3;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale3, 'contrato_assinado', now() - interval '2 day');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale3, 150000, 7500, 'concluida') RETURNING id INTO v_occ3;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ3, 'corretor_vendedor', 'Detalhe Teste B', v_b, 7500);

  -- v_c: 1 venda de lançamento, sem equipe
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_c, 'ocorrencia_analise_financeiro', 'lancamento', 100000, 'TESTE-DETALHE-C1') RETURNING id INTO v_sale4;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale4, 'ocorrencia_analise_financeiro', now() - interval '1 day');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale4, 100000, 5000, 'pendente') RETURNING id INTO v_occ4;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ4, 'corretor_vendedor', 'Detalhe Teste C', v_c, 5000);
END $$;

\echo '--- ranking_corretor (visao_executiva_stats) ---'
SELECT jsonb_pretty(r.stats->'ranking_corretor')
FROM (SELECT public.visao_executiva_stats() AS stats) r;

\echo '--- ranking_equipe (visao_executiva_stats) ---'
SELECT jsonb_pretty(r.stats->'ranking_equipe')
FROM (SELECT public.visao_executiva_stats() AS stats) r;

\echo '--- detalhe: corretor v_a (esperado: 2 vendas, soma 25000) ---'
SELECT jsonb_pretty(public.visao_executiva_detalhe_comissao(_corretor_id => '72915db6-7c2c-4760-81c6-cd68fb91e322'));

\echo '--- detalhe: equipe v_team (esperado: 3 vendas v_a+v_b, soma 32500) ---'
SELECT jsonb_pretty(public.visao_executiva_detalhe_comissao(_team_id => '33333333-3333-3333-3333-333333333333'));

\echo '--- detalhe: sem equipe (deve incluir v_c, soma >= 5000) ---'
SELECT jsonb_pretty(public.visao_executiva_detalhe_comissao(_sem_equipe => true));
