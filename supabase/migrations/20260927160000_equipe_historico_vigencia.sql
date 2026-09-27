-- Itens 7 e 8 (decisões de Denis, 27/09/2026) — histórico de equipe com vigência.
-- Regra: quem troca de equipe leva para a equipe anterior o que fez antes da troca; o que fizer
-- depois conta para a equipe atual. A venda é atribuída pela equipe vigente na DATA DA ASSINATURA
-- (venda_em da base canônica: último contrato_assinado; Lançamento = sales.data_assinatura).
--
-- * Nova tabela team_membership_history (pessoa → equipe, vigente_de/vigente_ate).
-- * Carga inicial = estado atual de team_members. NÃO existem registros de trocas passadas no
--   banco (team_members guarda só o vínculo atual; activity_logs não registra equipes), então a
--   vigência de cada vínculo começa no início dos dados do sistema (menor data entre equipes,
--   vendas, histórico de status e assinaturas) — registrado em COMMENT e na coluna origem.
-- * Trigger em team_members grava o histórico a cada inclusão/remoção/troca (tela de Equipe,
--   cadastro de usuário ou qualquer outro caminho). Para corrigir um vínculo que sempre existiu,
--   um script de dados pode definir `set local app.equipe_vigencia_desde = '<timestamptz>'`.
-- * equipe_vigente(pessoa, data): equipe do histórico nessa data; sem vínculo, a própria equipe
--   se a pessoa for líder dela e a equipe tiver membros OU a pessoa tiver o cargo team_leader
--   (item 7: Pamela, Orlando e Alexandra contam como equipe própria; Aline — gestor/lançamento,
--   equipe sem membros — fica sem equipe: Lançamento é modalidade, não equipe).
-- * equipe_vigencias(): as mesmas regras para Produção por pessoa e Comparativo 6% (front).
-- * RPCs alteradas (CREATE OR REPLACE): participacoes_comerciais_validas (Equipes, metas e
--   detalhe do Desempenho), desempenho_ranking_periodo, comissao_coordenador_dados.
-- Rollback: docs/sql/rollback/20260927160000_equipe_historico_vigencia.rollback.sql

CREATE TABLE IF NOT EXISTS public.team_membership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membro_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  vigente_de timestamptz NOT NULL,
  vigente_ate timestamptz,
  origem text NOT NULL DEFAULT 'team_members' CHECK (origem IN ('carga_inicial', 'team_members')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_membership_history_periodo_ck CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_de),
  CONSTRAINT team_membership_history_sem_sobreposicao EXCLUDE USING gist (
    membro_id WITH =,
    tstzrange(vigente_de, coalesce(vigente_ate, 'infinity'::timestamptz), '[)') WITH &&
  )
);
CREATE INDEX IF NOT EXISTS team_membership_history_team_idx ON public.team_membership_history (team_id);

COMMENT ON TABLE public.team_membership_history IS
  'Vínculo pessoa→equipe com vigência. Carga inicial (origem=carga_inicial) = team_members em 27/09/2026 com vigente_de no início dos dados, pois não havia registro de trocas anteriores. Mantida pelo trigger trg_team_members_historico.';

ALTER TABLE public.team_membership_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_membership_history_select ON public.team_membership_history;
CREATE POLICY team_membership_history_select ON public.team_membership_history
  FOR SELECT TO authenticated
  USING (
    has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin','juridico','financeiro']::app_role[])
    OR membro_id = (SELECT auth.uid())
    OR sees_team(team_id, (SELECT auth.uid()))
  );
REVOKE ALL ON public.team_membership_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_membership_history TO authenticated;

INSERT INTO public.team_membership_history (membro_id, team_id, vigente_de, vigente_ate, origem, created_by)
SELECT tm.membro_id, tm.team_id,
  least(
    (SELECT min(created_at) FROM public.teams),
    (SELECT min(created_at) FROM public.sales),
    (SELECT min(created_at) FROM public.sale_status_history),
    (SELECT min(data_assinatura)::timestamp AT TIME ZONE 'America/Sao_Paulo' FROM public.sales)
  ),
  NULL, 'carga_inicial', NULL
FROM public.team_members tm
WHERE NOT EXISTS (SELECT 1 FROM public.team_membership_history h WHERE h.membro_id = tm.membro_id);

CREATE OR REPLACE FUNCTION public.registrar_historico_team_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_em timestamptz := coalesce(nullif(current_setting('app.equipe_vigencia_desde', true), '')::timestamptz, now());
begin
  if tg_op in ('DELETE', 'UPDATE') then
    update public.team_membership_history
       set vigente_ate = greatest(v_em, vigente_de)
     where membro_id = old.membro_id and team_id = old.team_id and vigente_ate is null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.team_membership_history
       set vigente_ate = greatest(v_em, vigente_de)
     where membro_id = new.membro_id and vigente_ate is null;
    insert into public.team_membership_history (membro_id, team_id, vigente_de, origem)
    values (new.membro_id, new.team_id, v_em, 'team_members');
  end if;
  return null;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.registrar_historico_team_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_team_members_historico ON public.team_members;
CREATE TRIGGER trg_team_members_historico
  AFTER INSERT OR DELETE OR UPDATE OF team_id, membro_id ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.registrar_historico_team_members();

CREATE OR REPLACE FUNCTION public.equipe_vigente(_user uuid, _em timestamptz)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select h.team_id from public.team_membership_history h
      where h.membro_id = _user and h.vigente_de <= _em
        and (h.vigente_ate is null or h.vigente_ate > _em)
      order by h.vigente_de desc limit 1),
    (select t.id from public.teams t
      where t.lider_id = _user
        and (exists (select 1 from public.team_members m where m.team_id = t.id)
             or public.has_role(_user, 'team_leader'))
      order by t.created_at limit 1)
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.equipe_vigente(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_vigente(uuid, timestamptz) TO authenticated;

-- Para o front (Produção por pessoa, Comparativo 6%): histórico + equipe própria de líder (mesma
-- regra do item 7) + líder-auxiliar (regra que essas duas telas já usavam). Leitura sob RLS.
CREATE OR REPLACE FUNCTION public.equipe_vigencias()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(x order by x->>'prioridade', x->>'de'), '[]'::jsonb) from (
    select jsonb_build_object('membro_id', h.membro_id, 'team_id', h.team_id, 'de', h.vigente_de,
      'ate', h.vigente_ate, 'prioridade', 1) x
    from public.team_membership_history h
    union all
    select jsonb_build_object('membro_id', t.lider_id, 'team_id', t.id, 'de', null, 'ate', null, 'prioridade', 2)
    from (select distinct on (t.lider_id) t.* from public.teams t
          where t.lider_id is not null
            and (exists (select 1 from public.team_members m where m.team_id = t.id)
                 or public.has_role(t.lider_id, 'team_leader'))
          order by t.lider_id, t.created_at) t
    union all
    select jsonb_build_object('membro_id', c.user_id, 'team_id', c.team_id, 'de', null, 'ate', null, 'prioridade', 3)
    from public.team_co_leaders c
  ) s;
$function$;
REVOKE EXECUTE ON FUNCTION public.equipe_vigencias() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipe_vigencias() TO authenticated;

CREATE OR REPLACE FUNCTION public.participacoes_comerciais_validas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, user_id uuid, valor_individual numeric, valor_equipe numeric, conta_equipe boolean, team_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with por_pessoa as (
    select v.sale_id, v.venda_em, oc.user_id,
      sum(oc.valor) as valor_individual,
      coalesce(sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'), 0) as valor_equipe,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe
    from public.vendas_comerciais_canonicas() v
    join occurrences o on o.sale_id = v.sale_id
    join occurrence_commissions oc on oc.occurrence_id = o.id
    where oc.user_id is not null and coalesce(oc.sem_cadastro_confirmado, false) = false
    group by v.sale_id, v.venda_em, oc.user_id
  )
  select p.sale_id, p.venda_em, p.user_id, p.valor_individual, p.valor_equipe, p.conta_equipe,
    case when p.conta_equipe then public.equipe_vigente(p.user_id, p.venda_em) end as team_id
  from por_pessoa p;
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_ranking_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vendas_periodo as (
    select
      v.sale_id,
      v.venda_em as fechado_em,
      s.created_at as sale_created_at,
      s.modalidade::text as modalidade
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), devolucoes as (
    select sale_id, count(*) as n
    from sale_status_history
    where para::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    group by sale_id
  ), participante_venda as (
    select
      oc.user_id,
      vp.sale_id,
      sum(oc.valor) as valor_na_venda,
      coalesce(
        sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'),
        0
      ) as valor_equipe_na_venda,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel = 'coordenador_lancamento'
      ) as gestao_lancamento,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel <> 'coordenador_lancamento'
      ) as corretora_lancamento,
      max(vp.fechado_em) as fechado_em,
      max(extract(epoch from (vp.fechado_em - vp.sale_created_at)) / 86400.0) as dias,
      bool_or(coalesce(d.n, 0) > 0) as teve_devolucao
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    left join devolucoes d on d.sale_id = vp.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id
  ), ranking_corretor_base as (
    select
      user_id as corretor_id,
      count(*) as vendas_fechadas,
      avg(dias) as tempo_medio_dias,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(valor_na_venda) as comissao,
      bool_or(gestao_lancamento) as gestao_lancamento,
      bool_or(corretora_lancamento) as corretora_lancamento
    from participante_venda
    group by user_id
  ), unidade as (
    -- equipe ATUAL da pessoa (só para exibir ao lado do nome no ranking individual)
    select p.corretor_id, public.equipe_vigente(p.corretor_id, now()) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
  ), ranking_corretor_full as (
    select r.*, u.team_id
    from ranking_corretor_base r
    left join unidade u on u.corretor_id = r.corretor_id
  ), ranking_corretor as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'corretor_id', corretor_id,
      'vendas_fechadas', vendas_fechadas,
      'tempo_medio_dias', round(tempo_medio_dias::numeric, 1),
      'taxa_devolucao', round((100.0 * vendas_com_devolucao / nullif(vendas_fechadas, 0))::numeric, 0),
      'comissao', comissao,
      'gestao_lancamento', gestao_lancamento,
      'corretora_lancamento', corretora_lancamento
    ) order by comissao desc, vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_corretor_full
  ), equipe_vendas as (
    select
      p.team_id,
      p.sale_id,
      bool_or(p.teve_devolucao) as teve_devolucao,
      sum(p.valor_equipe_na_venda) as comissao
    from (
      select p.*, public.equipe_vigente(p.user_id, p.fechado_em) as team_id
      from participante_venda p
      where p.conta_equipe
    ) p
    where p.team_id is not null
    group by p.team_id, p.sale_id
  ), ranking_equipe_base as (
    select
      team_id,
      count(*) as vendas_fechadas,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(comissao) as comissao
    from equipe_vendas
    group by team_id
  ), ranking_equipe as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.team_id,
      'team_nome', t.nome,
      'vendas_fechadas', r.vendas_fechadas,
      'comissao', r.comissao,
      'taxa_devolucao', round((100.0 * r.vendas_com_devolucao / nullif(r.vendas_fechadas, 0))::numeric, 0)
    ) order by r.comissao desc, r.vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_equipe_base r
    join teams t on t.id = r.team_id
  ), captacoes as (
    select count(distinct id) as quantidade
    from sales
    where created_at >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and status::text not in ('cancelada','arquivada')
  )
  select jsonb_build_object(
    'ranking_corretor', (select valor from ranking_corretor),
    'ranking_equipe', (select valor from ranking_equipe),
    'quantidade_captacoes', (select quantidade from captacoes)
  )
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$
;

CREATE OR REPLACE FUNCTION public.comissao_coordenador_dados(p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with occs as (
    select o.id as occurrence_id, s.modalidade::text as modalidade, v.venda_em
    from public.vendas_comerciais_validas() v
    join public.sales s on s.id = v.sale_id
    join public.occurrences o on o.sale_id = s.id
    where o.status = 'concluida'
      and s.status::text not in ('cancelada', 'arquivada')
      and v.venda_em >= (date_trunc('month', p_mes)::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', oc.occurrence_id,
    'modalidade', occs.modalidade,
    'papel', oc.papel,
    'user_id', oc.user_id,
    'nome', p.nome,
    'valor', oc.valor,
    'sem_cadastro_confirmado', coalesce(oc.sem_cadastro_confirmado, false),
    'cargo_gestor', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'gestor'),
    'cargo_team_leader', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'team_leader'),
    'lideres_equipe', coalesce((
      select jsonb_agg(distinct t.lider_id)
      from public.team_membership_history h
      join public.teams t on t.id = h.team_id
      where h.membro_id = oc.user_id and t.lider_id is not null
        and h.vigente_de <= occs.venda_em
        and (h.vigente_ate is null or h.vigente_ate > occs.venda_em)
    ), '[]'::jsonb)
  ) order by oc.occurrence_id, oc.papel, oc.user_id nulls last, oc.valor), '[]'::jsonb)
  from public.occurrence_commissions oc
  join occs on occs.occurrence_id = oc.occurrence_id
  left join public.profiles p on p.id = oc.user_id
  where public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]);
$function$
;
