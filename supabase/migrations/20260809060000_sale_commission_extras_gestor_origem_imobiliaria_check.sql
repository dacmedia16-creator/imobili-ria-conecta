-- Regra 4 (bases de gestor/team leader/indicador/outros extras): origem de gestor/team_leader é
-- obrigatoriamente "imobiliaria" — nunca sai do captador/vendedor. A UI já não deixa mais escolher
-- outra origem pra esses dois papéis; esta constraint garante isso também pra quem grava direto
-- pela API/RPC, não só quem passa pela tela.
alter table public.sale_commission_extras
  add constraint sale_commission_extras_gestor_origem_imobiliaria_check
  check (papel not in ('gestor', 'team_leader') or origem = 'imobiliaria');
