-- Resumo do ensaio (linhas "RES|..."). Falha com exceção se qualquer critério não for atendido.
reset role;
-- 1) matriz de permissões: cada fase comparada com ANTES (perfil x tabela/relatório)
select 'MATRIZ|' || f.fase || '|comparacoes=' || count(*) || '|identicas=' ||
       count(*) filter (where a.n is not distinct from f.n and a.h is not distinct from f.h)
from matriz a join matriz f on f.papel = a.papel and f.objeto = a.objeto and f.fase <> 'antes'
where a.fase = 'antes' group by f.fase order by f.fase;
select 'MATRIZ_DIF|' || f.fase || '|' || a.papel || '|' || a.objeto || '|antes=' || a.n || '|' || f.fase || '=' || f.n
from matriz a join matriz f on f.papel = a.papel and f.objeto = a.objeto and f.fase <> 'antes'
where a.fase = 'antes' and (a.n is distinct from f.n or a.h is distinct from f.h);
-- 2) tabela nova: cada perfil vê nela exatamente as vendas que vê em sales
select 'MATRIZ_VD|' || v.fase || '|perfis=' || count(*) || '|iguais_a_sales=' ||
       count(*) filter (where v.n is not distinct from s.n and v.h is not distinct from s.h)
from matriz v join matriz s on s.fase = v.fase and s.papel = v.papel and s.objeto = 'tab:sales'
where v.objeto = 'vd:venda_distribuicao' and v.papel <> 'anonimo_sem_login' group by v.fase order by v.fase;
select 'MATRIZ_VD_ANONIMO|' || fase || '|' || coalesce(h, '') || '|linhas=' || n
from matriz where objeto = 'vd:venda_distribuicao' and papel = 'anonimo_sem_login' order by fase;
-- 3) multiempresa: ninguém vê venda de outra imobiliária, em nenhuma fase
select 'MATRIZ_MULTIEMPRESA|vendas_de_outra_imobiliaria_vistas=' || coalesce(sum(n) filter (where n > 0), 0)
from matriz where objeto = 'rpc:outra_imobiliaria_vistas';
-- 4) equivalência lista nova x can_view_sale
select 'EQUIV|' || fase || '|perfis=' || count(*) || '|so_antigo=' || sum(so_antigo) || '|so_novo=' || sum(so_novo)
       || '|vendas_conferidas=' || sum(total)
from equiv group by fase order by fase;
-- 5) tempos (ms, melhor de 2) antes x depois
select 'TEMPO|' || a.perfil || '|' || a.consulta || '|antes=' || a.ms || '|depois=' || d.ms || '|x' ||
       case when d.ms > 0 then round(a.ms / d.ms, 1)::text else '-' end
from tempos a join tempos d on d.perfil = a.perfil and d.consulta = a.consulta and d.fase = 'depois'
where a.fase = 'antes' order by a.perfil, a.consulta;
-- 6) critérios (exceção = ensaio reprovado)
do $r$
declare v_bad int;
begin
  select count(*) into v_bad from matriz a join matriz f on f.papel = a.papel and f.objeto = a.objeto and f.fase <> 'antes'
   where a.fase = 'antes' and (a.n is distinct from f.n or a.h is distinct from f.h);
  if v_bad > 0 then raise exception 'ERRO_MATRIZ: % diferenças de permissão', v_bad; end if;
  select count(*) into v_bad from matriz v join matriz s on s.fase = v.fase and s.papel = v.papel and s.objeto = 'tab:sales'
   where v.objeto = 'vd:venda_distribuicao' and v.papel <> 'anonimo_sem_login'
     and (v.n is distinct from s.n or v.h is distinct from s.h);
  if v_bad > 0 then raise exception 'ERRO_VD: % perfis veem na tabela nova algo diferente de sales', v_bad; end if;
  if exists (select 1 from matriz where objeto = 'vd:venda_distribuicao' and papel = 'anonimo_sem_login' and n > 0) then
    raise exception 'ERRO_VD_ANONIMO: anônimo enxerga a tabela nova'; end if;
  if (select coalesce(sum(n), 0) from matriz where objeto = 'rpc:outra_imobiliaria_vistas' and n > 0) > 0 then
    raise exception 'ERRO_MULTIEMPRESA'; end if;
  if (select coalesce(sum(so_antigo + so_novo), 0) from equiv) > 0 then raise exception 'ERRO_EQUIV'; end if;
  if (select count(distinct papel) from matriz) <> 16 then raise exception 'ERRO_PERFIS: esperado 16'; end if;
  raise notice 'RES|APROVADO';
end $r$;
select 'FIM';
