-- Reconciliação financeira (itens 1 e 2): resultado GRAVADO x cálculo oficial AO VIVO, em TODAS as vendas,
-- depois de cada um dos 14 tipos de mudança. Falha (exceção) se qualquer venda divergir ou faltar.
-- Roda como postgres, dentro de SAVEPOINT (as edições de teste são desfeitas no fim do arquivo).
-- Passos 2–14: validações de negócio desligadas (replica) e SÓ os gatilhos novos ligados, para provar a
-- manutenção do resultado gravado em cada tipo de mudança. Passos 15–16: gatilhos normais (origin), para provar
-- que o gatilho novo convive com os atuais (inclusive a sincronização extras -> comissões da ocorrência).
reset role;
savepoint recon;
create or replace function pg_temp.recon(_etapa text) returns void language plpgsql as $$
declare v_vendas int; v_dif int; v_falta int; v_sobra int;
begin
  select count(*) into v_vendas from public.sales;
  select count(*) filter (where situacao = 'diferente'), count(*) filter (where situacao = 'faltando'),
         count(*) filter (where situacao = 'sobrando')
    into v_dif, v_falta, v_sobra from public.venda_distribuicao_conferir();
  raise notice 'RECON|%|vendas=%|diferentes=%|faltando=%|sobrando=%', _etapa, v_vendas, v_dif, v_falta, v_sobra;
  if v_dif + v_falta + v_sobra > 0 then
    raise exception 'RECONCILIAÇÃO FALHOU na etapa %: % diferentes, % faltando, % sobrando', _etapa, v_dif, v_falta, v_sobra;
  end if;
end $$;

select pg_temp.recon('01-carga inicial');
alter table public.sales enable always trigger zz_venda_distribuicao;
alter table public.sale_commission_extras enable always trigger zz_venda_distribuicao;
alter table public.occurrences enable always trigger zz_venda_distribuicao;
alter table public.occurrence_commissions enable always trigger zz_venda_distribuicao;
set local session_replication_role = replica;

update public.sales set valor_comissao_captador = valor_comissao_captador + 123.45
 where codigo_interno in ('POC10','POC11','POC12');
select pg_temp.recon('02-edita comissão do captador (3 vendas)');
update public.sales set valor_total_comissao = valor_total_comissao + 50, valor_remax = valor_remax + 10, valor_negociado = valor_negociado + 1000
 where codigo_interno = 'POC20';
select pg_temp.recon('03-edita VGV/comissão total/REMAX');
update public.sales set parceria_tipo = 'imobiliaria_externa', parceria_valor = 999, parceria_nome = 'Nova parceira'
 where codigo_interno = 'POC25';
select pg_temp.recon('04-inclui parceria externa na venda');
insert into public.sale_commission_extras (sale_id, nome, papel, origem, user_id, valor, sem_cadastro_confirmado, organization_id)
select id, 'Gestor novo POC', 'gestor', 'imobiliaria', 'cab7391a-463f-4d97-b99b-ced6e4696796', 777, false, organization_id
 from public.sales where codigo_interno in ('POC32','POC35');
select pg_temp.recon('05-inclui extra (gestor)');
update public.sale_commission_extras set valor = valor + 1, origem = 'imobiliaria' where nome = 'Gestor novo POC';
select pg_temp.recon('06-altera extra');
update public.sale_commission_extras set sale_id = (select id from public.sales where codigo_interno='POC33' and organization_id='00000000-0000-4000-8000-000000000001')
 where nome = 'Gestor novo POC' and sale_id = (select id from public.sales where codigo_interno='POC32' and organization_id='00000000-0000-4000-8000-000000000001');
select pg_temp.recon('07-move extra para outra venda');
delete from public.sale_commission_extras where nome = 'Gestor novo POC';
select pg_temp.recon('08-remove extra');
update public.occurrence_commissions set valor = valor + 99 where papel='outro' and managed_by_sale = false;
select pg_temp.recon('09-altera comissão manual da ocorrência');
insert into public.occurrence_commissions (occurrence_id, papel, valor, managed_by_sale, sem_cadastro_confirmado, organization_id)
select o.id, 'outro', 321, false, false, o.organization_id from public.occurrences o join public.sales s on s.id=o.sale_id where s.codigo_interno='POC41';
select pg_temp.recon('10-inclui comissão manual na ocorrência');
delete from public.occurrence_commissions where papel='outro' and managed_by_sale = false and not sem_cadastro_confirmado and valor > 400;
select pg_temp.recon('11-remove comissão manual');
delete from public.occurrences o using public.sales s where s.id=o.sale_id and s.codigo_interno='POC50';
select pg_temp.recon('12-remove ocorrência inteira');
update public.sales set status = 'cancelada' where codigo_interno='POC60';
select pg_temp.recon('13-cancela venda');
insert into public.sales (id, organization_id, corretor_id, status, modalidade, valor_negociado, valor_total_comissao, valor_comissao_captador, valor_comissao_vendedor, percentual_remax, valor_remax, codigo_interno)
values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 'ebffaded-075c-493f-89e2-1d3d62901dc4', 'rascunho', 'padrao', 500000, 30000, 6000, 6000, 4.2, 21000, 'RECON14');
select pg_temp.recon('14-cria venda nova');

-- com os gatilhos de negócio LIGADOS (caminho real de gravação), identificado como o admin sintético da
-- imobiliária A (as travas de comissão exigem um gestor/financeiro/admin identificado)
set local session_replication_role = origin;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated')::text, true),
       set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
-- (só vendas cujas pessoas existem de fato em profiles: a massa sintética foi semeada sem checar FK)
update public.sales set valor_comissao_vendedor = coalesce(valor_comissao_vendedor, 0) + 7
 where codigo_interno = 'RECON14';
select pg_temp.recon('15-edita venda com gatilhos normais');
update public.sale_commission_extras e set valor = valor + 3
  from public.sales s where s.id = e.sale_id and s.status = 'rascunho' and s.modalidade = 'padrao'
   and s.organization_id = '00000000-0000-4000-8000-000000000001' and e.user_id is not null
   and not exists (select 1 from (values (s.corretor_id), (s.corretor_captador_id), (s.corretor_vendedor_id),
         (s.lider_captador_id), (s.lider_vendedor_id), (s.indicador_captador_id), (e.user_id)) p(u)
       where p.u is not null and not exists (select 1 from public.profiles pr where pr.id = p.u));
select pg_temp.recon('16-edita extras com gatilhos normais');
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

-- totais dos relatórios: gravado x ao vivo (todas as vendas, sem filtro de papel)
select 'liquido_imobiliaria' metrica,
  sum(coalesce((vd.resultado->>'saldo_liquido_imobiliaria')::numeric,(vd.resultado->>'saldo_imobiliaria')::numeric,0)) gravado,
  sum(coalesce((public.calcular_distribuicao_venda(s.*)->>'saldo_liquido_imobiliaria')::numeric,(public.calcular_distribuicao_venda(s.*)->>'saldo_imobiliaria')::numeric,0)) ao_vivo
from public.sales s join public.venda_distribuicao vd on vd.sale_id=s.id;
rollback to savepoint recon;
release savepoint recon;
