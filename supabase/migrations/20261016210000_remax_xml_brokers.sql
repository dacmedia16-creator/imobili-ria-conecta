-- Corretores do XML VRSync RE/MAX -> perfis do ADM (t_e8265cce; Denis autorizou guardar nome, e-mail e telefone).
-- Depende de 20261016200000_remax_xml_feed.sql. NÃO aplicada em produção. Rollback:
-- supabase/rollback/20261016210000_remax_xml_brokers.sql
--
-- 1) remax_xml_brokers: nome, e-mail e telefone de cada corretor do XML, por imobiliária (um por ID RE/MAX).
--    Leitura só com RLS: mesma imobiliária e papel que já vê os corretores (gestor, team leader, jurídico,
--    financeiro, admin). Escrita só pelo servidor. Nada disso vai para log ou mensagem de erro.
-- 2) Cruzamento, nesta ordem: ID RE/MAX -> e-mail (minúsculas, sem espaços) -> telefone (só dígitos, sem DDI 55,
--    sem o 9º dígito do celular; telefone usado por mais de um corretor no XML não liga).
-- 3) Conflito nunca liga sozinho: vai para remax_xml_broker_revisao (lista persistida para o admin).
--    Conflitos: e-mail/telefone em mais de um perfil; ID e contato apontando para perfis diferentes; perfil
--    escolhido que já tem outro ID RE/MAX ou já está com outro corretor; e-mail e telefone divergentes.
-- 4) remax_xml_broker_vinculos: vínculo novo é só ADICIONADO, com a origem (id/email/telefone). Nunca é
--    atualizado nem apagado pela coleta; nada é gravado em profiles. Só o admin encerra (soft) pela revisão.
-- 5) Roda sozinho a cada coleta boa (gatilho em remax_xml_runs), dentro da mesma transação do ingest.
BEGIN;

-- Chaves de comparação ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remax_email_key(_e text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(lower(regexp_replace(coalesce(_e, ''), '\s', '', 'g')), '')
$$;

-- DDD + 8 dígitos. Tira DDI 55 (12/13 dígitos), zeros à esquerda e o 9º dígito do celular (11 dígitos com 9 na
-- 3ª posição). Sem DDD ou tamanho estranho = NULL (não liga).
CREATE OR REPLACE FUNCTION public.remax_tel_key(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN length(e) = 10 THEN e END
    FROM (SELECT CASE WHEN length(d) = 11 AND substr(d, 3, 1) = '9' THEN substr(d, 1, 2) || substr(d, 4) ELSE d END AS e
            FROM (SELECT CASE WHEN length(x) IN (12, 13) AND x LIKE '55%' THEN substr(x, 3) ELSE x END AS d
                    FROM (SELECT ltrim(regexp_replace(coalesce(_t, ''), '\D', '', 'g'), '0') AS x) a) b) c
$$;

-- Tabelas -----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remax_xml_brokers (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (agent_id ~ '^[0-9]{9}$'),
  nome text,
  email text,
  telefone text,
  email_key text GENERATED ALWAYS AS (public.remax_email_key(email)) STORED,
  tel_key text GENERATED ALWAYS AS (public.remax_tel_key(telefone)) STORED,
  anuncios integer NOT NULL DEFAULT 0,
  first_seen date NOT NULL,
  last_seen date NOT NULL,
  last_run uuid NOT NULL,
  PRIMARY KEY (organization_id, agent_id)
);
CREATE INDEX IF NOT EXISTS remax_xml_brokers_run_idx ON public.remax_xml_brokers (organization_id, last_run);

CREATE TABLE IF NOT EXISTS public.remax_xml_broker_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (agent_id ~ '^[0-9]{9}$'),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origem text NOT NULL CHECK (origem IN ('id', 'email', 'telefone', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_run uuid,
  created_by uuid,
  encerrado_em timestamptz,
  encerrado_por uuid
);
-- um vínculo vigente por corretor do XML; os encerrados ficam como histórico
CREATE UNIQUE INDEX IF NOT EXISTS remax_xml_broker_vinculos_vigente
  ON public.remax_xml_broker_vinculos (organization_id, agent_id) WHERE encerrado_em IS NULL;

CREATE TABLE IF NOT EXISTS public.remax_xml_broker_revisao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('id_varios_perfis', 'id_diverge_contato', 'vinculo_diverge',
    'email_varios_perfis', 'telefone_varios_perfis', 'perfil_com_outro_id', 'perfil_em_outro_corretor',
    'email_telefone_divergem')),
  candidatos uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'superado', 'resolvido')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_run uuid,
  closed_at timestamptz,
  closed_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS remax_xml_broker_revisao_pendente
  ON public.remax_xml_broker_revisao (organization_id, agent_id, motivo) WHERE status = 'pendente';

-- RLS: mesma imobiliária + papel que já enxerga os corretores. Escrita só pelo servidor (sem policy de escrita).
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['remax_xml_brokers', 'remax_xml_broker_vinculos', 'remax_xml_broker_revisao'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', _t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', _t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', _t);
    EXECUTE format('CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE TO authenticated '
      'USING (organization_id = (SELECT public.current_org_id())) '
      'WITH CHECK (organization_id = (SELECT public.current_org_id()))', _t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_select', _t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
      '(SELECT public.has_any_role((SELECT auth.uid()), ARRAY[''gestor'', ''team_leader'', ''juridico'', '
      '''financeiro'', ''admin'', ''super_admin'']::public.app_role[])))', _t || '_select', _t);
  END LOOP;
END $$;

-- Avaliação ---------------------------------------------------------------------------------------------------
-- Uma linha por corretor do XML da coleta _run. profile_id só quando o vínculo é seguro.
-- via: id | email | telefone | admin | conflito | sem_cadastro. motivo preenchido = vai para a revisão
-- (com profile_id NULL bloqueia; com profile_id é só aviso, porque o vínculo já existia).
CREATE OR REPLACE FUNCTION public.remax_xml_broker_eval(_org uuid, _run uuid)
RETURNS TABLE(agent_id text, profile_id uuid, via text, motivo text, candidatos uuid[], novo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH b AS (
    SELECT b.agent_id, b.email_key, b.tel_key FROM public.remax_xml_brokers b
     WHERE b.organization_id = _org AND b.last_run = _run
  ),
  tel_unico AS (SELECT b.tel_key FROM b WHERE b.tel_key IS NOT NULL GROUP BY b.tel_key HAVING count(*) = 1),
  prof AS (
    SELECT p.id, nullif(btrim(p.remax_id), '') AS remax_id, public.remax_email_key(p.email) AS email_key,
           public.remax_tel_key(p.telefone) AS tel_key
      FROM public.profiles p WHERE p.organization_id = _org AND p.ativo
  ),
  vinc AS (
    SELECT v.agent_id, v.profile_id, v.origem FROM public.remax_xml_broker_vinculos v
      JOIN prof ON prof.id = v.profile_id
     WHERE v.organization_id = _org AND v.encerrado_em IS NULL
  ),
  c AS (
    SELECT b.agent_id,
      coalesce((SELECT array_agg(p.id ORDER BY p.id) FROM prof p WHERE p.remax_id = b.agent_id), '{}') AS by_id,
      coalesce((SELECT array_agg(p.id ORDER BY p.id) FROM prof p
                 WHERE b.email_key IS NOT NULL AND p.email_key = b.email_key), '{}') AS by_email,
      coalesce((SELECT array_agg(p.id ORDER BY p.id) FROM prof p
                 WHERE p.tel_key = b.tel_key AND b.tel_key IN (SELECT t.tel_key FROM tel_unico t)), '{}') AS by_tel,
      v.profile_id AS v_pid, v.origem AS v_origem
      FROM b LEFT JOIN vinc v ON v.agent_id = b.agent_id
  ),
  f AS (
    SELECT c.*,
      CASE WHEN cardinality(c.by_email) > 0 THEN 'email' WHEN cardinality(c.by_tel) > 0 THEN 'telefone' END AS lvl,
      CASE WHEN cardinality(c.by_email) > 0 THEN c.by_email ELSE c.by_tel END AS ids,
      cardinality(c.by_id) = 1 AND (
        (cardinality(c.by_email) > 0 AND NOT c.by_id[1] = ANY(c.by_email)) OR
        (cardinality(c.by_tel) > 0 AND NOT c.by_id[1] = ANY(c.by_tel))) AS div_id
      FROM c
  ),
  -- perfis já "tomados" por algum corretor do XML (ID, vínculo vigente ou candidato único novo)
  claim AS (
    SELECT f.agent_id, x AS pid FROM f, unnest(f.by_id) x
    UNION SELECT f.agent_id, f.v_pid FROM f WHERE f.v_pid IS NOT NULL
    UNION SELECT f.agent_id, f.ids[1] FROM f
     WHERE cardinality(f.by_id) = 0 AND f.v_pid IS NULL AND cardinality(f.ids) = 1
  ),
  d AS (
    SELECT f.*,
      CASE
        WHEN cardinality(f.by_id) > 1 THEN 'id_varios_perfis'
        WHEN cardinality(f.by_id) = 1 THEN
          CASE WHEN f.v_pid IS NOT NULL AND f.v_pid <> f.by_id[1] THEN 'vinculo_diverge'
               WHEN f.div_id THEN 'id_diverge_contato' END
        WHEN f.v_pid IS NOT NULL THEN
          CASE WHEN cardinality(f.ids) > 0 AND NOT f.v_pid = ANY(f.ids) THEN 'vinculo_diverge' END
        WHEN f.lvl IS NULL THEN NULL
        WHEN cardinality(f.ids) > 1 THEN CASE f.lvl WHEN 'email' THEN 'email_varios_perfis' ELSE 'telefone_varios_perfis' END
        WHEN EXISTS (SELECT 1 FROM prof p WHERE p.id = f.ids[1] AND p.remax_id IS NOT NULL) THEN 'perfil_com_outro_id'
        WHEN f.lvl = 'email' AND cardinality(f.by_tel) > 0 AND NOT f.ids[1] = ANY(f.by_tel) THEN 'email_telefone_divergem'
        WHEN EXISTS (SELECT 1 FROM claim x WHERE x.pid = f.ids[1] AND x.agent_id <> f.agent_id) THEN 'perfil_em_outro_corretor'
      END AS motivo
      FROM f
  ),
  e AS (
    SELECT d.*,
      CASE
        WHEN cardinality(d.by_id) > 1 THEN NULL
        WHEN cardinality(d.by_id) = 1 THEN
          CASE WHEN d.motivo IS NULL OR (d.motivo = 'id_diverge_contato' AND d.v_pid = d.by_id[1]) THEN d.by_id[1]
               WHEN d.motivo = 'vinculo_diverge' THEN d.v_pid END  -- vínculo existente é mantido (só aviso)
        WHEN d.v_pid IS NOT NULL THEN d.v_pid
        WHEN d.motivo IS NULL AND cardinality(d.ids) = 1 THEN d.ids[1]
      END AS pid
      FROM d
  )
  SELECT e.agent_id, e.pid,
    CASE WHEN e.pid IS NULL THEN CASE WHEN e.motivo IS NULL THEN 'sem_cadastro' ELSE 'conflito' END
         WHEN cardinality(e.by_id) = 1 THEN 'id'
         WHEN e.v_pid IS NOT NULL THEN e.v_origem
         ELSE e.lvl END,
    e.motivo,
    coalesce((SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(e.by_id || e.by_email || e.by_tel ||
      CASE WHEN e.v_pid IS NULL THEN '{}'::uuid[] ELSE ARRAY[e.v_pid] END) x), '{}'),
    e.pid IS NOT NULL AND e.v_pid IS NULL AND e.motivo IS NULL
    FROM e
$$;

-- Mesma assinatura de antes: o Feedback, o painel de vínculos e o mapa continuam iguais.
CREATE OR REPLACE FUNCTION public.remax_xml_broker_match(_org uuid)
RETURNS TABLE(agent_id text, profile_id uuid, via text, candidatos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.agent_id, e.profile_id, e.via, cardinality(e.candidatos)
    FROM public.remax_xml_broker_eval(_org, (public.remax_xml_last_ok(_org)).id) e
$$;

-- Sincronização (servidor) ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remax_xml_broker_sync(_org uuid, _run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _novos int; _rev int;
BEGIN
  INSERT INTO public.remax_xml_brokers AS t (organization_id, agent_id, nome, email, telefone, anuncios,
    first_seen, last_seen, last_run)
  SELECT _org, l.agent_id,
    left(mode() WITHIN GROUP (ORDER BY nullif(btrim(l.corretor_nome), '')), 160),
    left(mode() WITHIN GROUP (ORDER BY nullif(btrim(l.corretor_email), '')), 200),
    left(mode() WITHIN GROUP (ORDER BY nullif(btrim(l.corretor_telefone), '')), 30),
    count(*)::int, _hoje, _hoje, _run
    FROM public.remax_xml_listings l
   WHERE l.organization_id = _org AND l.last_run = _run AND l.agent_id ~ '^[0-9]{9}$'
   GROUP BY l.agent_id
  ON CONFLICT (organization_id, agent_id) DO UPDATE SET
    nome = coalesce(EXCLUDED.nome, t.nome), email = coalesce(EXCLUDED.email, t.email),
    telefone = coalesce(EXCLUDED.telefone, t.telefone), anuncios = EXCLUDED.anuncios,
    last_seen = EXCLUDED.last_seen, last_run = EXCLUDED.last_run;
  -- contato de corretor que sumiu do XML há mais de 60 dias não fica guardado (vínculos ficam)
  DELETE FROM public.remax_xml_brokers WHERE organization_id = _org AND last_seen < _hoje - 60;

  DROP TABLE IF EXISTS pg_temp._bm;
  CREATE TEMP TABLE _bm ON COMMIT DROP AS SELECT * FROM public.remax_xml_broker_eval(_org, _run);

  INSERT INTO public.remax_xml_broker_vinculos (organization_id, agent_id, profile_id, origem, created_run)
  SELECT _org, m.agent_id, m.profile_id, m.via, _run FROM _bm m WHERE m.novo
  ON CONFLICT (organization_id, agent_id) WHERE encerrado_em IS NULL DO NOTHING;
  GET DIAGNOSTICS _novos = ROW_COUNT;

  INSERT INTO public.remax_xml_broker_revisao AS r (organization_id, agent_id, motivo, candidatos, last_run)
  SELECT _org, m.agent_id, m.motivo, m.candidatos, _run FROM _bm m WHERE m.motivo IS NOT NULL
  ON CONFLICT (organization_id, agent_id, motivo) WHERE status = 'pendente'
  DO UPDATE SET candidatos = EXCLUDED.candidatos, last_seen = now(), last_run = EXCLUDED.last_run;
  GET DIAGNOSTICS _rev = ROW_COUNT;
  -- pendência que não aparece mais nesta coleta: fica como histórico ('superado'), não é apagada
  UPDATE public.remax_xml_broker_revisao SET status = 'superado', closed_at = now()
   WHERE organization_id = _org AND status = 'pendente' AND last_run IS DISTINCT FROM _run;

  RETURN jsonb_build_object('vinculos_novos', _novos, 'revisao', _rev);  -- só contagens
END $$;

CREATE OR REPLACE FUNCTION public.remax_xml_runs_broker_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.remax_xml_broker_sync(NEW.organization_id, NEW.id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS remax_xml_runs_broker_sync ON public.remax_xml_runs;
CREATE TRIGGER remax_xml_runs_broker_sync AFTER INSERT ON public.remax_xml_runs
  FOR EACH ROW WHEN (NEW.status = 'ok') EXECUTE FUNCTION public.remax_xml_runs_broker_sync();

-- Revisão pelo admin ------------------------------------------------------------------------------------------
-- _acao: 'confirmar_id' (vale o ID RE/MAX do cadastro: grava vínculo de origem 'admin' e encerra, sem apagar,
--         o vínculo automático divergente) | 'encerrar' (admin corrigiu o cadastro; só fecha a pendência).
CREATE OR REPLACE FUNCTION public.remax_xml_revisao_resolver(_id uuid, _acao text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _r public.remax_xml_broker_revisao%ROWTYPE;
  _pid uuid;
BEGIN
  IF NOT coalesce(public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[]), false) THEN
    RAISE EXCEPTION 'Somente admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _r FROM public.remax_xml_broker_revisao
   WHERE id = _id AND organization_id = _org AND status = 'pendente' FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Pendência não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _acao = 'confirmar_id' THEN
    SELECT p.id INTO _pid FROM public.profiles p
     WHERE p.organization_id = _org AND p.ativo AND p.remax_id = _r.agent_id;
    IF _pid IS NULL THEN RAISE EXCEPTION 'Nenhum usuário ativo com este ID RE/MAX' USING ERRCODE = '22023'; END IF;
    UPDATE public.remax_xml_broker_vinculos SET encerrado_em = now(), encerrado_por = _uid
     WHERE organization_id = _org AND agent_id = _r.agent_id AND encerrado_em IS NULL AND profile_id <> _pid;
    INSERT INTO public.remax_xml_broker_vinculos (organization_id, agent_id, profile_id, origem, created_by)
    VALUES (_org, _r.agent_id, _pid, 'admin', _uid)
    ON CONFLICT (organization_id, agent_id) WHERE encerrado_em IS NULL DO NOTHING;
  ELSIF _acao <> 'encerrar' THEN
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.remax_xml_broker_revisao SET status = 'resolvido', closed_at = now(), closed_by = _uid WHERE id = _r.id;
  RETURN 'ok';
END $$;

-- Permissões
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.remax_xml_broker_eval(uuid, uuid)', 'public.remax_xml_broker_sync(uuid, uuid)',
    'public.remax_xml_runs_broker_sync()', 'public.remax_xml_broker_match(uuid)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.remax_xml_revisao_resolver(uuid, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.remax_xml_revisao_resolver(uuid, text) TO authenticated';
  FOREACH _f IN ARRAY ARRAY['public.remax_email_key(text)', 'public.remax_tel_key(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f);
  END LOOP;
END $$;

-- Carga inicial: imobiliárias que já têm coleta boa passam a ter cadastro e vínculos sem esperar o próximo cron.
DO $$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT DISTINCT ON (organization_id) organization_id, id FROM public.remax_xml_runs
             WHERE status = 'ok' ORDER BY organization_id, finished_at DESC LOOP
    PERFORM public.remax_xml_broker_sync(_r.organization_id, _r.id);
  END LOOP;
END $$;

COMMIT;
