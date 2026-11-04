-- Dados ANTES da migration 20261104170000 (t_05a37081), para provar a carga inicial. Fictícios.
-- Roda dentro da transação revertida do run-comemora-pergunta-login.sh; nunca produção.
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  ('e0000000-0000-4000-8000-0000000000e0', 'teste-carga-e', 'Imobiliaria Carga', 'ativa', '00000000000353', '#112233', '#445566');
INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-4000-8000-000000000001'), ('e0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003'), ('e0000000-0000-4000-8000-000000000004');
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'Carga Um', 'e1@exemplo.test', true, 'e0000000-0000-4000-8000-0000000000e0'),
  ('e0000000-0000-4000-8000-000000000002', 'Carga Dois', 'e2@exemplo.test', true, 'e0000000-0000-4000-8000-0000000000e0'),
  ('e0000000-0000-4000-8000-000000000003', 'Carga Tres', 'e3@exemplo.test', true, 'e0000000-0000-4000-8000-0000000000e0'),
  ('e0000000-0000-4000-8000-000000000004', 'Carga Quatro', 'e4@exemplo.test', true, 'e0000000-0000-4000-8000-0000000000e0');
INSERT INTO public.profile_birthdates (user_id, data_nascimento, comemora_aniversario, updated_at) VALUES
  -- antes da tela nova, Sim por padrão: NUNCA respondeu
  ('e0000000-0000-4000-8000-000000000001', '1980-03-03', true,  '2026-10-01 12:00+00'),
  -- já está Não: respondeu
  ('e0000000-0000-4000-8000-000000000002', '1981-03-03', false, '2026-11-04 17:00+00'),
  -- gravou pela tela nova (depois do deploy do PR #265): respondeu
  ('e0000000-0000-4000-8000-000000000003', '1982-03-03', true,  '2026-11-04 19:00+00'),
  -- depois do deploy, mas quem gravou foi a gestão: NÃO conta como resposta
  ('e0000000-0000-4000-8000-000000000004', '1983-03-03', true,  '2026-11-04 19:00+00');
INSERT INTO public.activity_logs (organization_id, autor_id, sale_id, acao, payload, created_at) VALUES
  ('e0000000-0000-4000-8000-0000000000e0', NULL, NULL, 'user_birthdate_set',
   '{"target_user": "e0000000-0000-4000-8000-000000000004", "removida": false}', '2026-11-04 19:00:01+00');
SET LOCAL session_replication_role = origin;
