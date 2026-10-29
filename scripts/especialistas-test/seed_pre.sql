-- Cenário fictício ANTES da migration 20261029150000 (formato igual ao de produção em 29/10/2026):
-- UE (histórica, Sorocaba/SP) com regiões em Sorocaba e Votorantim e escolhas de corretor; ZZ (Sorocaba/SP)
-- sem regiões; Capacitá (Nova Friburgo/RJ) com 1 região e 1 sugestão pendente; Volute sem cidade.
-- Só para banco LOCAL descartável. Uso: ver test.sh
\set ON_ERROR_STOP 1
BEGIN;
SET session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, legacy_default, cidade, uf) VALUES
  ('00000000-0000-4000-8000-000000000001', 'unica-escolha', 'RE/MAX Única Escolha', 'ativa', true, 'Sorocaba', 'SP'),
  ('e5000000-0000-0000-0000-00000000000b', 'zz-teste', 'ZZ Teste', 'ativa', false, 'Sorocaba', 'SP'),
  ('e5000000-0000-0000-0000-00000000000f', 'remax-capacita', 'REMAX CAPACITÁ', 'ativa', false, 'NOVA FRIBURGO', 'RJ'),
  ('e5000000-0000-0000-0000-00000000000e', 'remax-volute', 'RE/MAX Volute', 'ativa', false, NULL, NULL);
INSERT INTO auth.users (id, email) SELECT u, 'u' || right(u::text, 6) || '@exemplo.invalid' FROM unnest(ARRAY[
  'e5000000-0000-0000-0000-0000000a0a01', 'e5000000-0000-0000-0000-0000000a0c01', 'e5000000-0000-0000-0000-0000000a0c02',
  'e5000000-0000-0000-0000-0000000f0a01', 'e5000000-0000-0000-0000-0000000f0c01',
  'e5000000-0000-0000-0000-0000000e0c01']::uuid[]) u;
INSERT INTO public.profiles (id, nome, ativo, organization_id, telefone) VALUES
  ('e5000000-0000-0000-0000-0000000a0a01', 'Admin UE', true, '00000000-0000-4000-8000-000000000001', NULL),
  ('e5000000-0000-0000-0000-0000000a0c01', 'Corretora UE Um', true, '00000000-0000-4000-8000-000000000001', '15999990001'),
  ('e5000000-0000-0000-0000-0000000a0c02', 'Corretor UE Dois', true, '00000000-0000-4000-8000-000000000001', NULL),
  ('e5000000-0000-0000-0000-0000000f0a01', 'Admin Capacita', true, 'e5000000-0000-0000-0000-00000000000f', NULL),
  ('e5000000-0000-0000-0000-0000000f0c01', 'Corretor Capacita', true, 'e5000000-0000-0000-0000-00000000000f', NULL),
  ('e5000000-0000-0000-0000-0000000e0c01', 'Corretor Volute', true, 'e5000000-0000-0000-0000-00000000000e', NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo)
SELECT organization_id, id, true FROM public.profiles WHERE id::text LIKE 'e5000000%';
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  ('e5000000-0000-0000-0000-0000000a0a01', 'admin', '00000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-0000-0000-0000000a0c01', 'corretor', '00000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-0000-0000-0000000a0c02', 'corretor', '00000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-0000-0000-0000000f0a01', 'admin', 'e5000000-0000-0000-0000-00000000000f'),
  ('e5000000-0000-0000-0000-0000000f0c01', 'corretor', 'e5000000-0000-0000-0000-00000000000f'),
  ('e5000000-0000-0000-0000-0000000e0c01', 'corretor', 'e5000000-0000-0000-0000-00000000000e');
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, m, true FROM public.organizations o, unnest(ARRAY['captacao_exclusiva', 'reserva_salas']) m
ON CONFLICT DO NOTHING;
INSERT INTO public.positioning_regions (id, organization_id, cidade, zona, nome, tipo) VALUES
  (9001, '00000000-0000-4000-8000-000000000001', 'Sorocaba', 'Sul', 'Campolim', 'bairro'),
  (9002, '00000000-0000-4000-8000-000000000001', 'Sorocaba', 'Leste', 'Wanel Ville', 'bairro'),
  (9003, '00000000-0000-4000-8000-000000000001', 'Votorantim', NULL, 'Condomínio Exemplo', 'condominio'),
  (9004, 'e5000000-0000-0000-0000-00000000000f', 'NOVA FRIBURGO', NULL, 'Olaria', 'bairro');
INSERT INTO public.corretor_positioning_regions (corretor_id, region_id, organization_id) VALUES
  ('e5000000-0000-0000-0000-0000000a0c01', 9001, '00000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-0000-0000-0000000a0c01', 9003, '00000000-0000-4000-8000-000000000001');
INSERT INTO public.positioning_region_suggestions (id, suggested_by, organization_id, cidade, zona, nome, tipo, status) VALUES
  ('e5000000-0000-0000-0000-00000000aa01', 'e5000000-0000-0000-0000-0000000f0c01', 'e5000000-0000-0000-0000-00000000000f',
   'Nova Friburgo', NULL, 'Cônego', 'bairro', 'pendente');
SET session_replication_role = origin;
COMMIT;
