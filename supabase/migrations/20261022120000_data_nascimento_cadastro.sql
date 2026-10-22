-- Data de nascimento no cadastro dos corretores (t_dff88e75, pedido de Denis em 22/10/2026).
--
-- A tabela public.profile_birthdates e a RPC public.profile_set_birthdate (própria pessoa) já existem
-- (20261015120000_mural_conquistas.sql). Esta migration:
--   1) passa a exigir idade mínima de 16 anos também na RPC da própria pessoa;
--   2) cria duas RPCs POR PESSOA para a gestão da imobiliária ler/gravar a data de um usuário:
--      mesma regra do "Editar dados do usuário" (user-management-policy.ts → edit_user):
--        - administrador / administrador principal: qualquer usuário da própria imobiliária;
--        - gestor: só quem é apenas corretor, na própria imobiliária;
--        - team leader: só corretores da própria equipe (is_lead_of);
--        - conta do administrador da plataforma: ninguém da agência mexe;
--        - administrador principal: só outro administrador principal mexe;
--        - nunca a própria conta (para isso existe profile_set_birthdate).
-- Não há leitura em massa: a tabela continua com a política "só o dono lê" e as RPCs recebem um
-- único usuário. Colegas continuam vendo só dia/mês (achievement_birthdays, inalterada).
-- Rollback: docs/sql/rollback/20261022120000_data_nascimento_cadastro.rollback.sql
-- Sem BEGIN/COMMIT próprios (igual às migrations recentes): o teste a inclui numa transação desfeita.

-- Regra de validade única (usada pelas três RPCs): 1900-01-01 <= data <= hoje (SP) - 16 anos.
CREATE OR REPLACE FUNCTION public.profile_birthdate_valida(_data date) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT _data IS NOT NULL
     AND _data >= DATE '1900-01-01'
     AND _data <= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '16 years')::date
$$;
REVOKE ALL ON FUNCTION public.profile_birthdate_valida(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_birthdate_valida(date) TO authenticated, service_role;

-- 1) Própria pessoa: mesma função de antes + idade mínima de 16 anos.
CREATE OR REPLACE FUNCTION public.profile_set_birthdate(_data date) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Sem sessao' USING ERRCODE = '42501'; END IF;
  IF _data IS NULL THEN
    DELETE FROM public.profile_birthdates WHERE user_id = _uid;
    RETURN NULL;
  END IF;
  IF NOT public.profile_birthdate_valida(_data) THEN
    RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_uid, _data)
  ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now();
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_set_birthdate(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_set_birthdate(date) TO authenticated, service_role;

-- 2) Quem chama pode gerenciar a data de _alvo? (falha fechada; não revela se o alvo existe em outra org)
CREATE OR REPLACE FUNCTION public.profile_birthdate_can_manage(_alvo uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _alvo_roles text[];
BEGIN
  IF _uid IS NULL OR _alvo IS NULL OR _alvo = _uid THEN RETURN false; END IF;
  _org := public.current_org_id();
  IF _org IS NULL THEN RETURN false; END IF;
  -- Alvo precisa ser membro ativo da MESMA imobiliária (user_org devolve NULL para outra org).
  IF public.user_org(_alvo) IS DISTINCT FROM _org THEN RETURN false; END IF;
  -- Conta do administrador da plataforma: protegida.
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = _alvo) THEN RETURN false; END IF;

  SELECT coalesce(array_agg(ur.role::text), ARRAY[]::text[]) INTO _alvo_roles
    FROM public.user_roles ur WHERE ur.user_id = _alvo AND ur.organization_id = _org;

  -- Administrador principal só é alterado por outro administrador principal.
  IF 'super_admin' = ANY(_alvo_roles)
     AND NOT public.has_role(_uid, 'super_admin'::public.app_role) THEN
    RETURN false;
  END IF;

  IF public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[]) THEN RETURN true; END IF;

  -- Gestor / team leader: só quem é APENAS corretor.
  IF cardinality(_alvo_roles) = 0 OR EXISTS (SELECT 1 FROM unnest(_alvo_roles) r WHERE r <> 'corretor') THEN
    RETURN false;
  END IF;
  IF public.has_role(_uid, 'gestor'::public.app_role) THEN RETURN true; END IF;
  IF public.has_role(_uid, 'team_leader'::public.app_role) AND public.is_lead_of(_uid, _alvo) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.profile_birthdate_can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_birthdate_can_manage(uuid) TO authenticated, service_role;

-- Lê a data completa de UM usuário (gestão). Sem permissão → erro 42501 (não devolve nada).
CREATE OR REPLACE FUNCTION public.profile_birthdate_get_for_user(_user uuid) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.profile_birthdate_can_manage(_user) THEN
    RAISE EXCEPTION 'Sem permissao para ver a data de nascimento deste usuario' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT b.data_nascimento FROM public.profile_birthdates b WHERE b.user_id = _user);
END $$;
REVOKE ALL ON FUNCTION public.profile_birthdate_get_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_birthdate_get_for_user(uuid) TO authenticated, service_role;

-- Grava (ou apaga, com NULL) a data de UM usuário (gestão). Auditoria sem guardar a data.
CREATE OR REPLACE FUNCTION public.profile_birthdate_set_for_user(_user uuid, _data date) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.profile_birthdate_can_manage(_user) THEN
    RAISE EXCEPTION 'Sem permissao para alterar a data de nascimento deste usuario' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _data IS NULL THEN
    DELETE FROM public.profile_birthdates WHERE user_id = _user;
  ELSE
    IF NOT public.profile_birthdate_valida(_data) THEN
      RAISE EXCEPTION 'Data de nascimento invalida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (_user, _data)
    ON CONFLICT (user_id) DO UPDATE SET data_nascimento = EXCLUDED.data_nascimento, updated_at = now();
  END IF;
  INSERT INTO public.activity_logs (organization_id, autor_id, sale_id, acao, payload)
  -- Visão da plataforma (super-admin dentro de uma imobiliária): ação marcada como tal na auditoria.
  VALUES (_org, auth.uid(), NULL,
          CASE WHEN current_setting('mt.ctx_pc', true) = '1' THEN 'user_birthdate_set_platform_context'
               ELSE 'user_birthdate_set' END,
          jsonb_build_object('target_user', _user, 'removida', _data IS NULL));
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION public.profile_birthdate_set_for_user(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_birthdate_set_for_user(uuid, date) TO authenticated, service_role;
