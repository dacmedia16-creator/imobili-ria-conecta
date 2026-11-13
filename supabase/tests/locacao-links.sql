-- Rodar exclusivamente na homologação dentro de BEGIN ... ROLLBACK (run-locacao-links.sh).
CREATE TEMP TABLE r(ok boolean, msg text);
CREATE FUNCTION pg_temp.ok(v boolean, m text) RETURNS void LANGUAGE sql AS $$ INSERT INTO r VALUES (coalesce(v,false),m) $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
GRANT ALL ON r TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;
SELECT pg_temp.ok((SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('locacao_links','locacao_link_modos','locacao_link_arquivos','locacao_link_tentativas') AND c.relrowsecurity)=4,'RLS nas quatro tabelas');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.locacao_link_ler(text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.locacao_link_ler(text,text)','EXECUTE')
  AND has_function_privilege('service_role','public.locacao_link_ler(text,text)','EXECUTE'),'endpoint público apenas no servidor');
CREATE TEMP TABLE fixture(k text primary key, id uuid);
CREATE TEMP TABLE toks(k text primary key, t text);
GRANT ALL ON fixture, toks TO authenticated, service_role;
WITH l AS (INSERT INTO public.locacoes(organization_id, corretor_id, etapa, garantia, ficha)
 VALUES ('00000000-0000-4000-8000-000000000001','ebffaded-075c-493f-89e2-1d3d62901dc4','documentacao','fiador','{"proprietario_pessoa":"pj"}') RETURNING id)
 INSERT INTO fixture SELECT 'A', id FROM l;
WITH l AS (INSERT INTO public.locacoes(organization_id, corretor_id, etapa, garantia)
 VALUES ('2a000000-0000-4000-8000-0000000000b0','23e65aaf-2614-463e-baec-cf562bb94244','documentacao','fiador') RETURNING id)
 INSERT INTO fixture SELECT 'B', id FROM l;
-- Corretor A só pode criar links na sua imobiliária.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_links_modo(%L,''cliente'')',(SELECT id FROM fixture WHERE k='B')))='42501','bloqueia imobiliária B');
SELECT public.locacao_links_modo((SELECT id FROM fixture WHERE k='A'),'cliente');
INSERT INTO toks SELECT 'a', public.locacao_links_emitir((SELECT id FROM fixture WHERE k='A'),'proprietario')->>'token';
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_links_emitir(%L,''outra'')',(SELECT id FROM fixture WHERE k='A')))='22023','rejeita parte inexistente');
RESET ROLE;
SELECT pg_temp.ok((SELECT token_hash <> (SELECT t FROM toks WHERE k='a')
  AND token_hash=encode(extensions.digest((SELECT t FROM toks WHERE k='a'),'sha256'),'hex')
  AND expira_em > now()+interval '6 days' FROM public.locacao_links WHERE locacao_id=(SELECT id FROM fixture WHERE k='A')),'hash, 7 dias, sem token claro');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->>'parte')='proprietario'
  AND NOT (public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64)) ? 'aluguel')
  AND (public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->>'pessoa')='pj','visão só da parte, PJ, sem valores');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->'itens'))>0,'reusa checklist PJ');
SELECT pg_temp.ok(NOT (public.locacao_link_salvar((SELECT t FROM toks WHERE k='a'),repeat('1',64),'{"loc_nome":"Outra parte"}')->>'ok')::boolean,'não altera outra parte');
SELECT pg_temp.ok((public.locacao_link_salvar((SELECT t FROM toks WHERE k='a'),repeat('1',64),'{"prop_nome":"Pessoa Fictícia"}')->>'ok')::boolean,'salva dados da própria parte');
SELECT pg_temp.ok((public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->>'status')='em_preenchimento','status em preenchimento');
SELECT pg_temp.ok(NOT (public.locacao_link_preparar((SELECT t FROM toks WHERE k='a'),repeat('1',64),'RG/CNH do locatário','pdf')->>'ok')::boolean,'upload de outra parte bloqueado');
SELECT pg_temp.ok(NOT (public.locacao_link_preparar((SELECT t FROM toks WHERE k='a'),repeat('1',64), 'Item inválido','pdf')->>'ok')::boolean,'item inválido bloqueado');
CREATE TEMP TABLE envio AS SELECT x->>'item' AS item FROM jsonb_array_elements(public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->'itens') x LIMIT 1;
GRANT SELECT ON envio TO service_role;
ALTER TABLE envio ADD COLUMN path text;
UPDATE envio SET path = public.locacao_link_preparar((SELECT t FROM toks WHERE k='a'),repeat('1',64),item,'pdf')->>'path';
SELECT pg_temp.ok((SELECT path LIKE '00000000-0000-4000-8000-000000000001/%/proprietario/%.pdf' FROM envio),'upload assinado só no caminho organização/locação/parte');
SELECT pg_temp.ok(NOT (public.locacao_link_registrar((SELECT t FROM toks WHERE k='a'),repeat('1',64),(SELECT path FROM envio),'ficticio.pdf')->>'ok')::boolean,'sem objeto no Storage não registra');
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name) SELECT 'locacao-documentos',path FROM envio;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((public.locacao_link_registrar((SELECT t FROM toks WHERE k='a'),repeat('1',64),(SELECT path FROM envio),'ficticio.pdf')->>'ok')::boolean,'objeto carregado é registrado');
SELECT pg_temp.ok((public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('1',64))->'itens'->0->>'enviado')::boolean,'cliente vê item enviado');
SELECT pg_temp.ok((public.locacao_link_enviar((SELECT t FROM toks WHERE k='a'),repeat('1',64))->>'ok')::boolean,'cliente envia ao corretor');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.locacao_documentos WHERE locacao_id=(SELECT id FROM fixture WHERE k='A') AND storage_path=(SELECT path FROM envio)),'arquivo entregue só na submissão');
SELECT pg_temp.ok(NOT (public.locacao_link_salvar((SELECT t FROM toks WHERE k='a'),repeat('1',64),'{"prop_nome":"Novo"}')->>'ok')::boolean,'após envio não edita');
SELECT pg_temp.ok((SELECT valores->>'prop_nome'='Pessoa Fictícia' FROM public.locacao_contrato_dados WHERE locacao_id=(SELECT id FROM fixture WHERE k='A')),'dados chegam à conferência do corretor');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)',(SELECT id FROM fixture WHERE k='A')))='22023','sem todas as partes não vai à gestão');
INSERT INTO toks SELECT 'b',public.locacao_links_emitir((SELECT id FROM fixture WHERE k='A'),'proprietario')->>'token';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_link_ler((SELECT t FROM toks WHERE k='a'),repeat('2',64))->>'ok')::boolean,'reemitir invalida antigo');
SELECT pg_temp.ok((public.locacao_link_ler((SELECT t FROM toks WHERE k='b'),repeat('2',64))->>'status')='nao_aberto','novo link da mesma parte começa pendente');
UPDATE public.locacao_links SET expira_em=now()-interval '1 second' WHERE token_hash=encode(extensions.digest((SELECT t FROM toks WHERE k='b'),'sha256'),'hex');
SELECT pg_temp.ok(NOT (public.locacao_link_ler((SELECT t FROM toks WHERE k='b'),repeat('3',64))->>'ok')::boolean,'link vencido não abre');
SELECT pg_temp.ok(NOT (public.locacao_link_ler(repeat('0',64),repeat('4',64))->>'ok')::boolean,'token inexistente não abre');
SELECT public.locacao_link_ler(repeat('0',64),repeat('4',64)) FROM generate_series(1,121);
SELECT pg_temp.ok((SELECT quantidade>120 FROM public.locacao_link_tentativas WHERE ip_hash=repeat('4',64)),'tentativas contadas sem rollback');
SELECT pg_temp.ok(NOT (public.locacao_link_ler((SELECT t FROM toks WHERE k='b'),repeat('4',64))->>'ok')::boolean,'limite por IP bloqueia até token válido');
-- Todos os documentos no banco não liberam data nem conferência antes do clique do corretor.
RESET ROLE;
INSERT INTO public.locacao_documentos(organization_id,locacao_id,item,storage_path,nome_arquivo)
SELECT '00000000-0000-4000-8000-000000000001',(SELECT id FROM fixture WHERE k='A'), x,
  'qa/'||gen_random_uuid()::text, 'qa.pdf'
FROM unnest(public.locacao_checklist_l((SELECT l FROM public.locacoes l WHERE id=(SELECT id FROM fixture WHERE k='A')))) x
WHERE NOT EXISTS(SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id=(SELECT id FROM fixture WHERE k='A') AND d.item=x);
SELECT public.locacao_docs_situacao((SELECT id FROM fixture WHERE k='A'));
SELECT pg_temp.ok((SELECT docs_completos_em IS NULL FROM public.locacoes WHERE id=(SELECT id FROM fixture WHERE k='A')),'data completa aguarda confirmação do corretor');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok((public.locacao_detalhe((SELECT id FROM fixture WHERE k='A'))->>'docs_completa')::boolean = false,'detalhe não sinaliza documentação completa antes de confirmar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)',(SELECT id FROM fixture WHERE k='A')))='22023','mesmo com documentos completos faltam convites');
INSERT INTO toks SELECT 'c', public.locacao_links_emitir((SELECT id FROM fixture WHERE k='A'),'proprietario')->>'token';
INSERT INTO toks SELECT 'd', public.locacao_links_emitir((SELECT id FROM fixture WHERE k='A'),'locatario')->>'token';
INSERT INTO toks SELECT 'e', public.locacao_links_emitir((SELECT id FROM fixture WHERE k='A'),'fiador')->>'token';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.locacao_link_enviar((SELECT t FROM toks WHERE k='c'),repeat('5',64));
SELECT public.locacao_link_enviar((SELECT t FROM toks WHERE k='d'),repeat('5',64));
SELECT public.locacao_link_enviar((SELECT t FROM toks WHERE k='e'),repeat('5',64));
RESET ROLE;
-- A trava dos dados do contrato (20261112120000) continua valendo no modo cliente.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)',(SELECT id FROM fixture WHERE k='A')))='22023','partes enviadas, mas sem dados do contrato não vai à gestão');
RESET ROLE;
INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id, valores)
SELECT id, '00000000-0000-4000-8000-000000000001', jsonb_build_object(
  'loc_nome','Locatário Fictício','loc_cpf','529.982.247-25','loc_rg','1','loc_nacionalidade','brasileira','loc_estado_civil','solteiro(a)',
  'loc_profissao','x','loc_endereco','Rua Fictícia, 1','prop_nome','Empresa Fictícia','prop_cpf','111.444.777-35','prop_rg','2',
  'prop_nacionalidade','brasileira','prop_estado_civil','solteiro(a)','prop_profissao','x','prop_endereco','Rua Fictícia, 2',
  'fia_nome','Fiador Fictício','fia_cpf','390.533.447-05','fia_rg','3','fia_nacionalidade','brasileira','fia_estado_civil','solteiro(a)',
  'fia_profissao','x','fia_endereco','Rua Fictícia, 3','fia_matricula','123','fia_cartorio','1º','imv_inscricao','1','imv_energia','1',
  'imv_agua','1','imv_vagas','não possui','prazo_meses','30','inicio','2026-12-01','dia_vencimento','10')
FROM fixture WHERE k='A'
ON CONFLICT (locacao_id) DO UPDATE SET valores = EXCLUDED.valores;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok((public.locacao_enviar_documentacao((SELECT id FROM fixture WHERE k='A'))->>'etapa')='conferencia','corretor confirma próximo passo');
RESET ROLE;
SELECT pg_temp.ok((SELECT docs_completos_em IS NOT NULL FROM public.locacoes WHERE id=(SELECT id FROM fixture WHERE k='A')),'data completa só após envio pelo corretor');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ebffaded-075c-493f-89e2-1d3d62901dc4',true);
SELECT set_config('request.jwt.claims','{"sub":"ebffaded-075c-493f-89e2-1d3d62901dc4","role":"authenticated"}',true);
SELECT pg_temp.ok((public.locacao_detalhe((SELECT id FROM fixture WHERE k='A'))->>'docs_completa')::boolean,'detalhe sinaliza completa depois da confirmação');
RESET ROLE;
SELECT 'TOTAL=' || count(*) || ' PASSOU=' || count(*) FILTER (WHERE ok) FROM r;
SELECT 'FALHA: ' || msg FROM r WHERE NOT ok;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM r WHERE NOT ok) THEN RAISE EXCEPTION 'Falha na suíte locacao-links'; END IF; END $$;
