-- Testes da migration 20261029100000_crm_dois_funis (card t_188fb282) num clone LOCAL do banco
-- (estrutura sem dados). Dados 100% fictícios. Roda tudo numa transação e desfaz no fim (ROLLBACK).
-- Uso: bash scripts/crm-test/test_crm.sh <container> <banco>
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO authenticated, service_role;
CREATE TABLE t.res (n serial, ok boolean, label text);
GRANT ALL ON t.res TO authenticated; GRANT ALL ON SEQUENCE t.res_n_seq TO authenticated;
CREATE FUNCTION t.ok(_c boolean, _l text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.res (ok, label) VALUES (coalesce(_c, false), _l); END $$;
CREATE FUNCTION t.como(_u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION t.dono() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
-- true = o comando FALHOU; o texto do erro tem de conter _trecho (vazio = qualquer erro).
CREATE FUNCTION t.falha(_sql text, _trecho text DEFAULT '') RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN position(lower(_trecho) IN lower(SQLERRM)) > 0; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

\set orgZ '''2a000000-0000-0000-0000-000000000000'''
\set orgO '''0b000000-0000-0000-0000-000000000000'''
\set ges '''2a000000-0000-0000-0000-0000000000a1'''
\set tl '''2a000000-0000-0000-0000-0000000000b1'''
\set cA '''2a000000-0000-0000-0000-0000000000c1'''
\set cB '''2a000000-0000-0000-0000-0000000000c2'''
\set cX '''0b000000-0000-0000-0000-0000000000c1'''
\set gX '''0b000000-0000-0000-0000-0000000000a1'''
\set team '''2a000000-0000-0000-0000-00000000aa01'''
\set unit '''2a000000-0000-0000-0000-00000000bb01'''
\set capZ '''2a000000-0000-0000-0000-00000000cc01'''

-- Cadastro fictício (gatilhos de cadastro desligados só aqui: sem e-mail, sem sincronização) -----------
SET session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:orgZ, 'zz-teste-crm', 'ZZ Teste CRM', 'ativa'), (:orgO, 'outra-crm', 'Outra Imobiliária', 'ativa');
INSERT INTO auth.users (id, email) SELECT u, 'u' || left(u::text, 4) || right(u::text, 4) || '@exemplo.invalid'
  FROM unnest(ARRAY[:ges, :tl, :cA, :cB, :cX, :gX]::uuid[]) u;
INSERT INTO public.profiles (id, nome, ativo, organization_id) VALUES
  (:ges, 'Gestor Z', true, :orgZ), (:tl, 'TL Z', true, :orgZ), (:cA, 'Corretor A', true, :orgZ),
  (:cB, 'Corretor B', true, :orgZ), (:cX, 'Corretor X', true, :orgO), (:gX, 'Gestor X', true, :orgO);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:orgZ, :ges, true), (:orgZ, :tl, true), (:orgZ, :cA, true), (:orgZ, :cB, true), (:orgO, :cX, true), (:orgO, :gX, true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:ges, 'gestor', :orgZ), (:tl, 'team_leader', :orgZ), (:cA, 'corretor', :orgZ), (:cB, 'corretor', :orgZ),
  (:cX, 'corretor', :orgO), (:gX, 'gestor', :orgO);
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES (:team, :tl, 'Equipe TL', :orgZ);
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES (:cA, :team, :orgZ);
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:unit, :orgZ, 'Unidade Teste', '00000-J', 'Teste Ltda', 'Rua Fictícia, 1', 'Sorocaba', 'SP', '00000000000000', 'Teste');
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, created_by, template, unit_id, status, form_data, broker_name)
  VALUES (:capZ, :orgZ, :cA, :cA, 'remax-padrao', :unit, 'aprovada',
          '{"imovel":{"tipo_imovel":"Casa","bairro":"Jardim Exemplo","municipio":"Sorocaba","estado":"SP","valor_imovel":"R$ 500.000,00"}}', 'Corretor A');
SET session_replication_role = origin;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:orgZ, 'leads', true), (:orgZ, 'crm', true), (:orgZ, 'captacao_exclusiva', true),
  (:orgO, 'leads', true), (:orgO, 'crm', false)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = EXCLUDED.enabled;
SELECT public.leads_preparar_org(:orgZ), public.leads_preparar_org(:orgO);
UPDATE public.lead_config SET distribuicao = 'captador_depois_rodizio';

-- 0) Módulo -----------------------------------------------------------------------------------------
SELECT t.como(:cA);
SELECT t.ok(public.crm_enabled(), 'C00 CRM ligado na ZZ (crm + leads)');
SELECT t.como(:cX);
SELECT t.ok(NOT public.crm_enabled(), 'C01 CRM desligado na outra imobiliária');
SELECT t.dono();
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :orgZ AND module = 'leads';
SELECT t.como(:cA);
SELECT t.ok(NOT public.crm_enabled(), 'C02 sem o módulo Leads o CRM não liga (usa as mesmas tabelas)');
SELECT t.dono();
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :orgZ AND module = 'leads';

-- 1) Distribuição reaproveitada: lead do imóvel vai para o captador; sem imóvel, rodízio ---------------
SELECT t.como(:ges);
SELECT public.lead_criar('Cliente Ficticio 1', '15900000001', NULL, 'manual', 'quero visitar', :capZ, NULL) AS l1 \gset
SELECT public.lead_criar('Cliente Ficticio 2', '15900000002', NULL, 'manual', NULL, NULL, :cB) AS l2 \gset
SELECT public.lead_criar('Proprietario Ficticio 3', '15900000003', NULL, 'manual', 'quero anunciar', NULL, :cA) AS l3 \gset
SELECT t.dono();
SELECT t.ok((SELECT responsavel_id FROM public.leads WHERE id = :'l1') = :cA, 'C03 lead do imóvel foi para o captador (captador_depois_rodizio)');
SELECT t.ok((SELECT funil FROM public.leads WHERE id = :'l1') = 'venda', 'C04 lead novo nasce no funil de venda');

-- 2) Visibilidade (RLS) ------------------------------------------------------------------------------
SELECT t.como(:cA);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE id = :'l2') = 0, 'C05 RLS: corretor A NÃO vê lead do corretor B');
SELECT t.ok((SELECT count(*) FROM public.leads WHERE id IN (:'l1', :'l3')) = 2, 'C06 RLS: corretor A vê os próprios');
SELECT t.ok((SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'l2') = 0, 'C07 RLS: linha do tempo do lead de B escondida de A');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', public.crm_hoje() + 1, ''ligar'')', :'l2'), 'nao encontrado'),
            'C08 corretor A não move lead de B pela RPC');
SELECT t.como(:cB);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE id IN (:'l1', :'l3')) = 0, 'C09 RLS: corretor B NÃO vê leads de A');
SELECT t.como(:tl);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE id IN (:'l1', :'l3')) = 2 AND (SELECT count(*) FROM public.leads WHERE id = :'l2') = 0,
            'C10 Team Leader vê a equipe (A) e não quem está fora (B)');
SELECT t.como(:ges);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE id IN (:'l1', :'l2', :'l3')) = 3, 'C11 gestor vê a imobiliária toda');
SELECT t.como(:cX);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE organization_id = :orgZ) = 0, 'C12 outra imobiliária não vê nada da ZZ');
SELECT t.como(:gX);
SELECT t.ok((SELECT count(*) FROM public.leads WHERE organization_id = :orgZ) = 0, 'C13 gestor de outra imobiliária não vê nada da ZZ');

-- 3) Contato só após aceite (mantido) ----------------------------------------------------------------
SELECT t.como(:cA);
SELECT t.ok((SELECT count(*) FROM public.lead_contatos(ARRAY[:'l1']::uuid[])) = 0, 'C14 antes do aceite o corretor não recebe telefone');
SELECT t.ok(t.falha('SELECT telefone FROM public.leads LIMIT 1'), 'C15 coluna telefone continua fechada para o app');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', public.crm_hoje() + 1, ''ligar'')', :'l1'), 'aceite o lead'),
            'C16 mover exige aceite antes (regra atual)');
SELECT t.ok((SELECT funil = 'venda' AND proximo_contato_em IS NULL AND sale_id IS NULL FROM public.leads WHERE id = :'l1'),
            'C17 colunas novas do CRM legíveis pelo app');
SELECT public.lead_aceitar(:'l1');
SELECT public.lead_aceitar(:'l3');
SELECT t.ok((SELECT count(*) FROM public.lead_contatos(ARRAY[:'l1']::uuid[])) = 1, 'C18 depois do aceite o telefone aparece');

-- 4) Mover exige próximo contato ---------------------------------------------------------------------
SELECT t.ok(t.falha(format('SELECT public.lead_mudar_etapa(%L, ''em_atendimento'')', :'l1'), 'proximo contato'),
            'C19 com CRM ligado, etapa aberta sem próximo contato é recusada (RPC antiga)');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', NULL, ''ligar'')', :'l1'), 'proximo contato')
        AND t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', public.crm_hoje() + 1, ''  '')', :'l1'), 'proximo contato'),
            'C20 sem data ou sem motivo: recusado');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', public.crm_hoje() - 1, ''ligar'')', :'l1'), 'invalida'),
            'C21 data no passado: recusada');
SELECT public.crm_mover(:'l1', 'em_atendimento', public.crm_hoje() + 2, 'Mandar fotos');
SELECT t.ok((SELECT etapa = 'em_atendimento' AND proximo_contato_em = public.crm_hoje() + 2 AND proximo_contato_motivo = 'Mandar fotos'
               AND ultima_interacao_em IS NOT NULL FROM public.leads WHERE id = :'l1'), 'C22 mover grava etapa + próximo contato e conta atendimento');
SELECT t.ok((SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'l1' AND tipo = 'proximo_contato') = 1, 'C23 próximo contato na linha do tempo');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''avaliacao'', public.crm_hoje() + 1, ''x'')', :'l1'), 'etapa invalida'),
            'C24 "Avaliação" não existe no funil de venda');
SELECT public.crm_proximo_contato(:'l1', public.crm_hoje(), 'Ligar hoje');
SELECT t.ok((SELECT proximo_contato_em = public.crm_hoje() FROM public.leads WHERE id = :'l1'), 'C25 atualizar só o próximo contato');
SELECT t.ok(t.falha(format('SELECT public.lead_mudar_etapa(%L, ''perdido'')', :'l1'), 'motivo da perda'), 'C26 perdido continua exigindo motivo');

-- 5) Funil de captação ---------------------------------------------------------------------------
SELECT public.crm_definir_funil(:'l3', 'captacao');
SELECT t.ok((SELECT funil FROM public.leads WHERE id = :'l3') = 'captacao', 'C27 lead passa para o funil de captação (em Novo)');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''visita_agendada'', public.crm_hoje() + 1, ''x'')', :'l3'), 'etapa invalida'),
            'C28 "Visita" não existe no funil de captação');
SELECT public.crm_mover(:'l3', 'avaliacao', public.crm_hoje() + 3, 'Levar estudo de mercado');
SELECT t.ok((SELECT etapa FROM public.leads WHERE id = :'l3') = 'avaliacao', 'C29 captação: etapa Avaliação');
SELECT t.ok(t.falha(format('SELECT public.crm_definir_funil(%L, ''venda'')', :'l3'), 'so troca'),
            'C30 não troca de funil depois de Em contato');

-- 6) Converter em venda ------------------------------------------------------------------------------
SELECT t.como(:cB);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_venda(%L)', :'l1'), 'nao encontrado'), 'C31 corretor B não converte lead de A');
SELECT t.como(:cA);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_venda(%L)', :'l3'), 'funil de venda'), 'C32 lead de captação não vira venda');
SELECT public.crm_converter_venda(:'l1') AS s1 \gset
SELECT t.ok((SELECT etapa = 'ganho' AND sale_id = :'s1'::uuid AND convertido_em IS NOT NULL AND proximo_contato_em IS NULL
               FROM public.leads WHERE id = :'l1'), 'C33 venda criada, lead em Fechado e vinculado');
SELECT t.ok((SELECT count(*) FROM public.sales WHERE id = :'s1') = 1, 'C34 corretor A enxerga a venda criada');
SELECT t.ok(public.crm_converter_venda(:'l1') = :'s1'::uuid, 'C35 converter de novo devolve a mesma venda (sem duplicar)');
SELECT t.dono();
SELECT t.ok((SELECT exclusive_capture_id = :capZ AND corretor_captador_id = :cA AND corretor_vendedor_id = :cA AND status = 'rascunho'
               AND imovel_bairro = 'Jardim Exemplo' FROM public.sales WHERE id = :'s1'),
            'C36 imóvel da captação: venda pelo "Virou venda" (captador, vendedor e imóvel preenchidos)');
SELECT t.ok((SELECT nome = 'Cliente Ficticio 1' AND telefone = '15900000001' FROM public.sale_parties WHERE sale_id = :'s1' AND papel = 'comprador_1'),
            'C37 comprador 1 preenchido com o lead');
SELECT t.ok((SELECT count(*) FROM public.lead_eventos WHERE lead_id = :'l1' AND tipo = 'convertido' AND para = 'venda') = 1, 'C38 conversão na linha do tempo');

-- Lead sem imóvel: venda comum. Gestor converte lead da equipe (vendedor = responsável).
SELECT t.como(:ges);
SELECT public.lead_criar('Cliente Ficticio 4', '15900000004', NULL, 'manual', NULL, NULL, :cB) AS l4 \gset
SELECT t.como(:cB);
SELECT public.lead_aceitar(:'l4');
SELECT t.como(:ges);
SELECT public.crm_converter_venda(:'l4') AS s4 \gset
SELECT t.dono();
SELECT t.ok((SELECT corretor_vendedor_id = :cB AND exclusive_capture_id IS NULL AND corretor_id = :ges FROM public.sales WHERE id = :'s4'),
            'C39 gestor converte: venda comum com o responsável como vendedor');
SELECT t.como(:cB);
SELECT t.ok((SELECT count(*) FROM public.sales WHERE id = :'s4') = 1, 'C40 corretor vendedor enxerga a venda criada pelo gestor');

-- 7) Converter em captação --------------------------------------------------------------------------
SELECT t.como(:tl);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_captacao(%L, %L)', :'l3', :unit), 'responsavel'),
            'C41 só o corretor responsável converte em captação (vira o captador)');
SELECT t.como(:cA);
SELECT public.crm_converter_captacao(:'l3', :unit) AS k3 \gset
SELECT t.ok((SELECT etapa = 'ganho' AND capture_convertida_id = :'k3'::uuid FROM public.leads WHERE id = :'l3'), 'C42 captação criada, lead em Captado e vinculado');
SELECT t.dono();
SELECT t.ok((SELECT captor_id = :cA AND status = 'rascunho' AND form_data->'proprietario_1'->>'nome_completo' = 'Proprietario Ficticio 3'
               AND form_data->'proprietario_1'->>'telefone_1' = '15900000003' FROM public.exclusive_captures WHERE id = :'k3'),
            'C43 captação pré-preenchida com o proprietário');
SELECT t.como(:cA);
SELECT t.ok(public.crm_converter_captacao(:'l3', :unit) = :'k3'::uuid, 'C44 converter de novo devolve a mesma captação');
-- Módulo Captação exclusiva desligado: "Converter em captação" recusado.
SELECT t.como(:ges);
SELECT public.lead_criar('Proprietario Ficticio 5', '15900000005', NULL, 'manual', NULL, NULL, :cA) AS l5 \gset
SELECT t.como(:cA);
SELECT public.lead_aceitar(:'l5');
SELECT public.crm_definir_funil(:'l5', 'captacao');
SELECT t.dono();
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :orgZ AND module = 'captacao_exclusiva';
SELECT t.como(:cA);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_captacao(%L, %L)', :'l5', :unit), 'desligada'),
            'C45 sem o módulo Captação exclusiva não converte em captação');
SELECT t.ok(public.crm_enabled(), 'C46 CRM continua ligado sem a Captação exclusiva (módulos independentes)');
SELECT t.dono();
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :orgZ AND module = 'captacao_exclusiva';

-- 8) Encerrado e reabertura --------------------------------------------------------------------------
SELECT t.como(:cA);
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''proposta'', public.crm_hoje() + 1, ''x'')', :'l1'), 'reabre'),
            'C47 corretor não reabre lead Fechado');
SELECT t.ok(t.falha(format('SELECT public.crm_proximo_contato(%L, public.crm_hoje() + 1, ''x'')', :'l1'), 'encerrado'),
            'C48 lead encerrado não recebe próximo contato');

-- 8b) Contato não vaza pela conversão antes do aceite (revisão de dúvida) -------------------------------
SELECT t.como(:ges);
SELECT public.lead_criar('Cliente Ficticio 6', '15900000006', NULL, 'manual', NULL, NULL, :cA) AS l6 \gset
SELECT t.como(:tl);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_venda(%L)', :'l6'), 'antes de converter'),
            'C54 Team Leader não converte lead ainda não aceito (telefone não vaza para a venda)');
SELECT t.como(:ges);
SELECT t.ok(t.falha(format('SELECT public.crm_converter_venda(%L)', :'l6'), 'antes de converter'),
            'C55 nem o gestor converte lead não aceito');
SELECT t.como(:cA);
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''novo'', public.crm_hoje() + 1, ''x'')', :'l6'), 'aceite o lead'),
            'C56 remarcar na mesma etapa também exige aceite');

-- 9) Imobiliária com CRM desligado: tudo como antes ----------------------------------------------------
SELECT t.como(:gX);
SELECT public.lead_criar('Cliente Ficticio X', '15900000009', NULL, 'manual', NULL, NULL, :cX) AS lx \gset
SELECT t.como(:cX);
SELECT public.lead_aceitar(:'lx');
SELECT t.ok(t.falha(format('SELECT public.crm_mover(%L, ''em_atendimento'', public.crm_hoje() + 1, ''x'')', :'lx'), 'crm desligado'),
            'C49 CRM desligado: RPCs do CRM recusam');
SELECT t.ok(public.lead_mudar_etapa(:'lx', 'em_atendimento') = 'em_atendimento', 'C50 CRM desligado: mudar etapa funciona como antes (sem próximo contato)');
SELECT t.ok(t.falha(format('SELECT public.lead_mudar_etapa(%L, ''avaliacao'')', :'lx'), 'etapa invalida'), 'C51 lead antigo (venda) não aceita Avaliação');

-- 10) Constraints ------------------------------------------------------------------------------------
SELECT t.dono();
SELECT t.ok(t.falha(format('UPDATE public.leads SET proximo_contato_em = current_date WHERE id = %L', :'lx'), 'leads_proximo_par'),
            'C52 data sem motivo é barrada pelo banco');
SELECT t.ok(t.falha(format('UPDATE public.leads SET sale_id = %L WHERE id = %L', :'s4', :'lx'), ''),
            'C53 vínculo com venda de outra imobiliária é barrado (FK composta)');

SELECT t.dono();
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHOU' END AS r, label FROM t.res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS total FROM t.res;
ROLLBACK;
