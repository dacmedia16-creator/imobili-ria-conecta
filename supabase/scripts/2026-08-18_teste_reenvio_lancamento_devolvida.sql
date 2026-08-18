-- Script DESCARTÁVEL, só para o Supabase local. Reproduz o cenário exato reportado (Aline): uma
-- venda de Lançamento devolvida pelo financeiro (devolvida_ajuste) tentando ser reenviada.

DO $$
DECLARE
  v_user uuid := '5aba9446-9c08-4f73-bfdc-483e915090bf';
  v_sale uuid;
  v_occ uuid;
BEGIN
  UPDATE public.profiles SET nome='Teste Reenvio Lancamento', ativo=true WHERE id = v_user;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_user, 'lancamento') ON CONFLICT DO NOTHING;

  DELETE FROM public.sales WHERE corretor_id = v_user;

  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, percentual_comissao, codigo_interno)
  VALUES (v_user, 'rascunho', 'lancamento', 100000, 6, 'TESTE-REENVIO-1')
  RETURNING id INTO v_sale;

  INSERT INTO public.sale_commission_extras (sale_id, papel, nome, sem_cadastro_confirmado, percentual, valor)
  VALUES (v_sale, 'corretor_vendedor', 'Fulano de Tal', true, 100, 6000);
END $$;

-- Envio inicial (rascunho -> ocorrencia_analise_financeiro), como o usuário de teste
SELECT set_config('request.jwt.claims', json_build_object('sub', '5aba9446-9c08-4f73-bfdc-483e915090bf', 'role','authenticated')::text, false);
SELECT public.criar_ocorrencia_lancamento(id) AS envio_inicial FROM public.sales WHERE corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf';

-- Financeiro devolve a venda (simulado direto no banco pra teste; contorna a trigger de transição
-- só porque este é um script de teste local, não o fluxo real da tela)
ALTER TABLE public.sales DISABLE TRIGGER trg_validate_sale_status;
UPDATE public.sales SET status = 'devolvida_ajuste' WHERE corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf';
INSERT INTO public.sale_status_history (sale_id, de, para, motivo)
SELECT id, 'ocorrencia_analise_financeiro', 'devolvida_ajuste', 'Teste: devolução simulada'
FROM public.sales WHERE corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf';
ALTER TABLE public.sales ENABLE TRIGGER trg_validate_sale_status;

SELECT id, status FROM public.sales WHERE corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf';

-- Reenvio (devolvida_ajuste -> ocorrencia_analise_financeiro) — este é o passo que estava
-- quebrado em produção ("Esta venda já foi enviada ao financeiro.")
SELECT set_config('request.jwt.claims', json_build_object('sub', '5aba9446-9c08-4f73-bfdc-483e915090bf', 'role','authenticated')::text, false);
SELECT public.criar_ocorrencia_lancamento(id) AS reenvio FROM public.sales WHERE corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf';

-- Verificações
SELECT s.status, count(o.id) AS qtd_ocorrencias
FROM public.sales s LEFT JOIN public.occurrences o ON o.sale_id = s.id
WHERE s.corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf'
GROUP BY s.status;

SELECT sh.de, sh.para, sh.motivo, sh.created_at
FROM public.sale_status_history sh
JOIN public.sales s ON s.id = sh.sale_id
WHERE s.corretor_id = '5aba9446-9c08-4f73-bfdc-483e915090bf'
ORDER BY sh.created_at;
