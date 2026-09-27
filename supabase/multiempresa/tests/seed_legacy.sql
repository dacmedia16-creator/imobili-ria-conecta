-- Dados SINTÉTICOS do legado (antes da migration). Nenhum dado real.
-- Usuários da agência histórica (Única Escolha) com UUIDs fixos 1xxxxxxx.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('10000000-0000-4000-8000-000000000001', 'ue.admin@example.test',    '{"nome":"UE Admin"}', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'ue.gestor@example.test',   '{"nome":"UE Gestor"}', '{}'),
  ('10000000-0000-4000-8000-000000000003', 'ue.corretor@example.test', '{"nome":"UE Corretor"}', '{}'),
  ('10000000-0000-4000-8000-000000000004', 'ue.fin@example.test',      '{"nome":"UE Financeiro"}', '{}');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', 'gestor'),
  ('10000000-0000-4000-8000-000000000004', 'financeiro');
INSERT INTO public.teams (id, lider_id, nome) VALUES
  ('1a000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Equipe UE');
INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES
  ('10000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-000000000001', 'corretor');
INSERT INTO public.clientes (id, tipo_pessoa, nome, cpf_cnpj) VALUES
  ('1c000000-0000-4000-8000-000000000001', 'fisica', 'Cliente Sintetico UE', '111.444.777-35');
INSERT INTO public.sales (id, corretor_id, imovel_id) VALUES
  ('15000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'IMV-001');
INSERT INTO public.sale_payment (sale_id) VALUES ('15000000-0000-4000-8000-000000000001');
INSERT INTO public.sale_documents (sale_id, tipo, parte) VALUES ('15000000-0000-4000-8000-000000000001', 'rg', 'comprador_1');
INSERT INTO public.occurrences (sale_id) VALUES ('15000000-0000-4000-8000-000000000001');
INSERT INTO public.room_reservations (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose) VALUES
  ('Barão Sala 1', current_date + 3, '10:00', '11:00', '10000000-0000-4000-8000-000000000003', 'UE Corretor', 'Reunião com cliente');
INSERT INTO public.positioning_regions (id, cidade, nome, tipo) VALUES (1001, 'Sorocaba', 'Campolim', 'bairro')
  ;
COMMIT;
