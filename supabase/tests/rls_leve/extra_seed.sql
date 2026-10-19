-- Massa SINTÉTICA extra (transação revertida): cobre team leader de sub-equipe (equipe-mãe liderada por outro),
-- usuário sem organização, mídia e partes nomeadas para os filtros da lista de Vendas, extras com corretor.
set local session_replication_role = replica;
insert into public.profiles (id, nome, ativo, organization_id) values
 ('d0000000-0000-4000-8000-0000000000a5', 'POC team leader sub', true, '00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a6', 'POC sem organizacao', true, '00000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, ativo) values
 ('00000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a5', true);
insert into public.user_roles (user_id, role, organization_id) values
 ('d0000000-0000-4000-8000-0000000000a5', 'team_leader', '00000000-0000-4000-8000-000000000001'),
 ('d0000000-0000-4000-8000-0000000000a6', 'corretor', '00000000-0000-4000-8000-000000000001');
-- sub-equipe da "Equipe UE" (líder UE Gestor), liderada pelo team leader novo, com o Corretor Três
insert into public.teams (id, lider_id, nome, parent_team_id, organization_id) values
 ('1b000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a5', 'POC Sub-equipe',
  '1a000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');
insert into public.team_members (team_id, membro_id, tipo, organization_id) values
 ('1b000000-0000-4000-8000-000000000001', 'a742cfda-4731-4fa8-989a-374d2fdf0820', 'corretor', '00000000-0000-4000-8000-000000000001');
-- co-líder também na sub-equipe (cobre co-liderança de equipe filha)
insert into public.team_co_leaders (team_id, user_id, organization_id) values
 ('1b000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001');
-- mídia e nomes de partes (filtros da lista)
update public.sales set midia = case when (abs(hashtext(id::text)) % 3) = 0 then 'Instagram' when (abs(hashtext(id::text)) % 3) = 1 then 'Portal' end;
update public.sale_parties set nome = 'Comprador ' || left(sale_id::text, 4) where nome is null or nome = '';
-- corretor liderado aparece como corretor extra (papel corretor_vendedor) em algumas vendas da sub-equipe
insert into public.sale_commission_extras (sale_id, nome, papel, origem, lado, user_id, valor, sem_cadastro_confirmado, organization_id)
select s.id, 'Extra corretor POC', 'corretor_vendedor', 'vendedor', null, '10000000-0000-4000-8000-000000000003', 100, false, s.organization_id
from public.sales s where s.corretor_id = 'a742cfda-4731-4fa8-989a-374d2fdf0820' and s.modalidade = 'padrao' limit 5;
set local session_replication_role = origin;
analyze public.sales; analyze public.teams; analyze public.team_members; analyze public.team_co_leaders;
