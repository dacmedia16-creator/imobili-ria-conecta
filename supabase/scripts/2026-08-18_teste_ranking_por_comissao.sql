-- Script DESCARTÁVEL, só para o Supabase local. Testa o novo ranking (por comissão, incluindo
-- Lançamento) com 2 cenários:
--   A) Venda PADRÃO com contrato_assinado dentro dos últimos 30 dias — já devia aparecer antes.
--   B) Venda de LANÇAMENTO (nunca passa por contrato_assinado) com 2 pessoas na divisão — antes
--      desta correção, ficava 100% fora do ranking e do resumo_operacional.

DO $$
DECLARE
  v_a uuid := '72915db6-7c2c-4760-81c6-cd68fb91e322'; -- padrão
  v_b uuid := 'ba7526db-242e-4ded-ab80-a6f0992249e7'; -- lançamento vendedor
  v_c uuid := '200b4e33-27a4-49f2-bd1d-e4813f8f84cf'; -- lançamento coordenador
  v_sale_padrao uuid;
  v_sale_lanc uuid;
  v_occ_padrao uuid;
  v_occ_lanc uuid;
  v_team uuid;
BEGIN
  UPDATE public.profiles SET nome='Padrao Teste Ranking', ativo=true WHERE id = v_a;
  UPDATE public.profiles SET nome='Lancamento Vendedor Teste', ativo=true WHERE id = v_b;
  UPDATE public.profiles SET nome='Lancamento Coord Teste', ativo=true WHERE id = v_c;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_a, 'corretor') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_b, 'lancamento') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_b, 'gestor') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_c, 'lancamento') ON CONFLICT DO NOTHING;

  -- Equipe com B e C, pra testar ranking_equipe também
  INSERT INTO public.teams (id, lider_id, nome) VALUES ('22222222-2222-2222-2222-222222222222', v_b, 'Equipe Teste Ranking')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES (v_c, '22222222-2222-2222-2222-222222222222', 'coordenador')
    ON CONFLICT (membro_id) DO UPDATE SET team_id = EXCLUDED.team_id;

  DELETE FROM public.sales WHERE corretor_id IN (v_a, v_b, v_c);

  -- A) Venda padrão, contrato assinado ontem
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_a, 'contrato_assinado', 'padrao', 300000, 'TESTE-RANKING-PADRAO') RETURNING id INTO v_sale_padrao;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale_padrao, 'contrato_assinado', now() - interval '1 day');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale_padrao, 300000, 15000, 'concluida') RETURNING id INTO v_occ_padrao;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ_padrao, 'corretor_vendedor', 'Padrao Teste Ranking', v_a, 15000);

  -- B) Venda de Lançamento, foi direto pra ocorrencia_analise_financeiro há 2 dias (NUNCA passou
  -- por contrato_assinado)
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno)
  VALUES (v_b, 'ocorrencia_analise_financeiro', 'lancamento', 100000, 'TESTE-RANKING-LANCAMENTO') RETURNING id INTO v_sale_lanc;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES (v_sale_lanc, 'ocorrencia_analise_financeiro', now() - interval '2 days');
  INSERT INTO public.occurrences (sale_id, valor_negociado, valor_comissao, status) VALUES (v_sale_lanc, 100000, 7000, 'pendente') RETURNING id INTO v_occ_lanc;
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ_lanc, 'corretor_vendedor', 'Lancamento Vendedor Teste', v_b, 6000);
  INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, user_id, valor) VALUES (v_occ_lanc, 'coordenador_lancamento', 'Lancamento Coord Teste', v_c, 1000);
END $$;

SELECT jsonb_pretty(
  jsonb_build_object(
    'ranking_corretor', r.stats->'ranking_corretor',
    'ranking_equipe', r.stats->'ranking_equipe',
    'resumo_operacional', r.stats->'resumo_operacional'
  )
)
FROM (SELECT public.visao_executiva_stats() AS stats) r;
