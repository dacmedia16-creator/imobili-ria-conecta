-- Suíte da lista padrão do Feedback para imobiliária nova (migration 20261027180000). Roda DENTRO de
-- transação revertida (run-feedback-lista-padrao-org-nova.sh). Dados fictícios; nada fica gravado.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;

-- 1. Imobiliária nova recebe 55 ações (33 marketing + 22 checklist), todas ativas.
INSERT INTO public.organizations (id, slug, nome, status)
VALUES ('7e570000-0000-4000-8000-0000000000a1', 'zz-teste-lista-padrao-a1', 'ZZ Teste Lista Padrão A1', 'ativa');
SELECT pg_temp.ok(count(*) = 55, 'org nova: 55 ações (veio ' || count(*) || ')')
  FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000a1';
SELECT pg_temp.ok(count(*) FILTER (WHERE list = 'marketing') = 33 AND count(*) FILTER (WHERE list = 'checklist') = 22
                  AND bool_and(active), 'org nova: 33 marketing + 22 checklist, todas ativas')
  FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000a1';
SELECT pg_temp.ok(count(*) = 33, 'marketing tem peso (vital/importante/complementar)')
  FROM public.owner_feedback_actions
 WHERE organization_id = '7e570000-0000-4000-8000-0000000000a1' AND list = 'marketing' AND weight IS NOT NULL;

-- 2. Nada específico de uma imobiliária na lista padrão.
SELECT pg_temp.ok(count(*) = 0, 'lista padrão sem Única Escolha/Sorocaba')
  FROM public.owner_feedback_actions
 WHERE organization_id = '7e570000-0000-4000-8000-0000000000a1'
   AND (label || ' ' || category) ~* '(única|unica escolha|sorocaba)';

-- 3. Idempotente: chamar de novo não duplica.
SELECT pg_temp.ok(public.owner_feedback_lista_padrao_copiar('7e570000-0000-4000-8000-0000000000a1') = 0,
                  'rodar de novo grava 0');
SELECT pg_temp.ok(count(*) = 55, 'continua 55 depois de rodar de novo')
  FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000a1';

-- 4. Não mexe em imobiliária que já tem lista (mesmo se diferente do padrão).
INSERT INTO public.organizations (id, slug, nome, status)
VALUES ('7e570000-0000-4000-8000-0000000000a2', 'zz-teste-lista-padrao-a2', 'ZZ Teste Lista Padrão A2', 'ativa');
DELETE FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000a2';
INSERT INTO public.owner_feedback_actions (organization_id, list, category, label, weight, sort)
VALUES ('7e570000-0000-4000-8000-0000000000a2', 'marketing', 'Própria', 'Ação própria da imobiliária', 'vital', 1);
SELECT pg_temp.ok(public.owner_feedback_lista_padrao_copiar('7e570000-0000-4000-8000-0000000000a2') = 0,
                  'org com lista própria: grava 0');
SELECT pg_temp.ok(count(*) = 1, 'org com lista própria continua só com a dela')
  FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000a2';

-- 5. Org inexistente/nula: não grava nada nem quebra.
SELECT pg_temp.ok(public.owner_feedback_lista_padrao_copiar('7e570000-0000-4000-8000-0000000000ff') = 0
                  AND public.owner_feedback_lista_padrao_copiar(NULL) = 0, 'org inexistente ou nula: 0');

-- 6. Usuário comum não consegue chamar a função.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.owner_feedback_lista_padrao_copiar(uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.owner_feedback_lista_padrao_copiar(uuid)', 'EXECUTE'),
                  'função fechada para anon/authenticated');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
