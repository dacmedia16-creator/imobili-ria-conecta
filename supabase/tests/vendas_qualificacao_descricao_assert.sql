-- Depois de aplicar migrations 20261005120000 e 20261005121000 no banco DESCARTÁVEL.
DO $$ BEGIN
 IF (SELECT imovel_observacoes_origem FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000002') <> 'manual'
 OR (SELECT imovel_observacoes FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000002') <> 'Texto legado preservado'
 THEN RAISE EXCEPTION 'Texto legado/origem alterados'; END IF;
 IF has_function_privilege('anon', 'public.corrigir_descricao_matricula(uuid,text)', 'EXECUTE')
 OR has_function_privilege('anon', 'public.aplicar_descricao_matricula(uuid)', 'EXECUTE')
 THEN RAISE EXCEPTION 'anon pode executar RPC'; END IF;
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF NOT public.aplicar_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000001')
 THEN RAISE EXCEPTION 'IA não aplicou extração'; END IF;
 IF public.corrigir_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000001','Tentativa corretor')
 THEN RAISE EXCEPTION 'corretor corrigiu pela RPC'; END IF;
 BEGIN
   UPDATE public.sales SET imovel_observacoes = 'Tentativa direta'
     WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001';
   RAISE EXCEPTION 'corretor alterou direto';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Somente jurídico ou admin%' THEN RAISE; END IF;
 END;
 IF (SELECT imovel_observacoes FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001') <> 'Descrição IA'
 THEN RAISE EXCEPTION 'descrição adulterada'; END IF;
END $$;
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF public.corrigir_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000001','B invadiu A')
 THEN RAISE EXCEPTION 'jurídico B corrigiu A'; END IF;
 IF public.aplicar_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000002')
 THEN RAISE EXCEPTION 'B aplicou IA em A'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001')
 THEN RAISE EXCEPTION 'B visualizou venda A'; END IF;
END $$;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
DO $$ BEGIN
 IF NOT public.corrigir_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000001','Correção jurídico A')
 THEN RAISE EXCEPTION 'jurídico A não corrigiu'; END IF;
 IF (SELECT imovel_descricao_corrigida_por FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001') <> auth.uid()
 OR (SELECT imovel_descricao_corrigida_em FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001') IS NULL
 THEN RAISE EXCEPTION 'auditoria jurídico ausente'; END IF;
END $$;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
DO $$ BEGIN
 IF NOT public.corrigir_descricao_matricula('aaaaaaaa-1000-0000-0000-000000000001','Correção admin A')
 THEN RAISE EXCEPTION 'admin A não corrigiu'; END IF;
 IF (SELECT imovel_descricao_corrigida_por FROM public.sales WHERE id = 'aaaaaaaa-1000-0000-0000-000000000001') <> auth.uid()
 THEN RAISE EXCEPTION 'auditoria admin incorreta'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.sale_bank_accounts WHERE parte = 'vendedor_1') <> 1
 THEN RAISE EXCEPTION 'conta bancária legada removida'; END IF;
END $$;
SELECT 'DB TESTS OK: bloqueio corretor, jurídico A/B, admin, auditoria, legado, anon, banco' AS resultado;
