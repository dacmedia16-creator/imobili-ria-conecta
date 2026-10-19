-- Comparação final (roda como supabase_admin dentro da transação do ensaio; nada é gravado de fato).
reset role;
-- 1) igualdade total por perfil x chamada: texto completo da saída e lista de vendas
select 'IGUAL|' || a.perfil || '|' || a.chamada || '|' || a.n || '|' ||
  case when d.texto is not distinct from a.texto and d.ids is not distinct from a.ids then 'sim' else 'NAO' end || '|' ||
  case when x.texto is not distinct from a.texto and x.ids is not distinct from a.ids then 'sim' else 'NAO' end
from saida a
join saida d on d.fase = 'depois' and d.perfil = a.perfil and d.chamada = a.chamada
join saida x on x.fase = 'desfeito' and x.perfil = a.perfil and x.chamada = a.chamada
where a.fase = 'antes'
order by a.perfil, a.chamada;

-- 2) diferenças (detalhe só se houver)
select 'DIFERENCA|' || a.perfil || '|' || a.chamada || '|antes=' || left(coalesce(a.texto, 'null'), 300) || '|depois=' || left(coalesce(d.texto, 'null'), 300)
from saida a join saida d on d.fase = 'depois' and d.perfil = a.perfil and d.chamada = a.chamada
where a.fase = 'antes' and (d.texto is distinct from a.texto or d.ids is distinct from a.ids);

-- 3) nenhuma venda de outra imobiliária (versão nova)
select 'VAZAMENTO|' || s.perfil || '|' || s.chamada || '|' || count(*)
from saida s
cross join lateral unnest(coalesce(s.ids, '{}')) v(id)
join public.sales sa on sa.id = v.id
left join public.organization_members m on m.user_id = nullif(s.uid, '')::uuid and m.ativo
where s.fase = 'depois' and sa.organization_id is distinct from m.organization_id
group by s.perfil, s.chamada;

-- Falhas da fixture não são sucesso de equivalência.
select 'ERRO_CHAMADA|' || perfil || '|' || chamada || '|' || left(texto, 240)
from saida where fase = 'antes' and n = -1
order by perfil, chamada;

-- 4) resumo
select 'RESUMO|comparacoes=' || count(*) ||
  '|iguais_depois=' || count(*) filter (where d.texto is not distinct from a.texto and d.ids is not distinct from a.ids) ||
  '|iguais_desfeito=' || count(*) filter (where x.texto is not distinct from a.texto and x.ids is not distinct from a.ids) ||
  '|com_linhas=' || count(*) filter (where a.n > 0) ||
  '|com_erro_antes=' || count(*) filter (where a.n = -1)
from saida a
join saida d on d.fase = 'depois' and d.perfil = a.perfil and d.chamada = a.chamada
join saida x on x.fase = 'desfeito' and x.perfil = a.perfil and x.chamada = a.chamada
where a.fase = 'antes';

-- 5) tempos (ms, melhor de 3, no servidor)
select 'TEMPO|' || a.perfil || '|' || a.consulta || '|antes=' || a.ms || '|depois=' || d.ms || '|desfeito=' || coalesce(x.ms::text, '-')
from tempos a
join tempos d on d.fase = 'depois' and d.perfil = a.perfil and d.consulta = a.consulta
left join tempos x on x.fase = 'desfeito' and x.perfil = a.perfil and x.consulta = a.consulta
where a.fase = 'antes' order by a.consulta, a.perfil;
select 'TEMPO_TOTAL|' || a.consulta || '|antes=' || round(sum(a.ms), 1) || '|depois=' || round(sum(d.ms), 1)
from tempos a join tempos d on d.fase = 'depois' and d.perfil = a.perfil and d.consulta = a.consulta
where a.fase = 'antes' group by a.consulta order by 1;
