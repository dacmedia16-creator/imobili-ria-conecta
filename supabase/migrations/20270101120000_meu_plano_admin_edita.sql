-- Meu Plano 2027 · o administrador abre e edita o plano de outra pessoa (cartão t_c9b0f633; Denis 24/11/2026,
-- tópico 6238: "ao clicar no nome da pessoa abre o plano dela como ela preenche, e os adm podem editar se for
-- preciso"; confirmado: só ADMINISTRADORES editam, gestor e líder no máximo visualizam).
--
-- QUEM:
--   editar  = admin/super_admin DESTA imobiliária (meu_plano_ve_imobiliaria) ou super admin da plataforma em
--             "Entrar como" — nunca o próprio plano (o próprio continua pelo Meu Plano normal).
--   ver     = os de cima + gestor/líder só da equipe que lidera (meu_plano_lider_ve), como já era na RLS de leitura.
--   recusa  = corretor comum, gestor/líder fora da equipe e qualquer um de outra imobiliária (42501).
--
-- O QUE É NOVO (só aditivo):
--   1) meu_plano_admin_edita(_alvo)              regra única de "pode editar" (usada pelas RPCs e pelo gatilho).
--   2) carreira_plano_acesso(_corretor)          diz à tela o modo (editar/ver) e o nome; recusa quem não pode.
--   3) carreira_plano_admin_salvar(...)          mesma validação do carreira_plano_salvar + a trava de valores;
--                                                grava antes/depois de cada campo em activity_logs.
--   4) carreira_plano_admin_usar_meta(...)       mesma regra/limites do carreira_plano_usar_meta, para a pessoa;
--                                                recusa plano com valor fora do limite; histórico antes/depois.
--   5) carreira_plano_trava_assinado()           ganha UMA exceção: dentro das RPCs acima (marcador da transação
--                                                + a mesma checagem de papel), respostas e meta oficial podem
--                                                mudar num plano assinado. Assinatura, trilha, dono, imobiliária e
--                                                ano continuam travados. O plano continua assinado.
-- O QUE NÃO MUDA: RLS, carreira_plano_salvar/usar_meta/assinar do corretor, cálculo da meta, realizado, somas e
-- farol. O admin não assina pelo corretor (não existe RPC para isso).
--
-- Rollback: docs/sql/rollback/20270101120000_meu_plano_admin_edita.rollback.sql (corpo de produção de 24/11 do
-- gatilho + DROP das funções novas). Testado só na homologação; NÃO aplicado em produção.
BEGIN;

CREATE OR REPLACE FUNCTION public.meu_plano_admin_edita(_alvo uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce(
    auth.uid() IS NOT NULL AND _alvo IS NOT NULL AND _alvo <> auth.uid()
    AND public.current_org_id() IS NOT NULL
    AND public.is_active_user(auth.uid())
    AND (public.meu_plano_ve_imobiliaria(auth.uid())
         OR (coalesce(public.is_platform_super_admin(auth.uid()), false)
             AND coalesce(public.mt_pc_in_context(), false)))
    AND EXISTS (SELECT 1 FROM public.organization_members m
                 WHERE m.organization_id = public.current_org_id() AND m.user_id = _alvo),
    false)
$function$;
REVOKE ALL ON FUNCTION public.meu_plano_admin_edita(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_plano_admin_edita(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carreira_plano_acesso(_corretor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _modo text; _nome text;
BEGIN
  _org := public.meu_plano_org_ok();   -- login, usuário ativo, imobiliária e módulo ligado
  IF _corretor IS NULL OR _corretor = _me THEN
    RETURN jsonb_build_object('modo', 'proprio');
  END IF;
  IF public.meu_plano_admin_edita(_corretor) THEN
    _modo := 'editar';
  ELSIF public.meu_plano_lider_ve(_corretor) THEN
    _modo := 'ver';
  ELSE
    RAISE EXCEPTION 'Sem acesso ao plano desta pessoa' USING ERRCODE = '42501';
  END IF;
  SELECT pr.nome INTO _nome FROM public.profiles pr WHERE pr.id = _corretor;
  RETURN jsonb_build_object('modo', _modo, 'nome', _nome);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_acesso(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_acesso(uuid) TO authenticated, service_role;

-- Histórico (mesmo padrão do carreira_plano_reabrir): autor nulo quando o ator não tem perfil nesta imobiliária
-- (super admin da plataforma), o gatilho de activity_logs recusa autor de outra imobiliária.
CREATE OR REPLACE FUNCTION public.carreira_plano_admin_log(_org uuid, _acao text, _payload jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
  VALUES (CASE WHEN EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.organization_id = _org)
               THEN auth.uid() END,
          NULL, _acao,
          _payload || jsonb_build_object('ator_id', auth.uid(),
            'ator_plataforma', coalesce(public.is_platform_super_admin(auth.uid()), false)
                               AND NOT public.meu_plano_ve_imobiliaria(auth.uid())),
          _org)
$function$;
REVOKE ALL ON FUNCTION public.carreira_plano_admin_log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_admin_log(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.carreira_plano_admin_salvar(_corretor uuid, _ano integer, _campos jsonb)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid; _k text; _v jsonb; _n int := 0; _em timestamptz;
        _p public.carreira_plano%ROWTYPE; _antes jsonb; _depois jsonb; _dif jsonb := '{}'::jsonb; _motivo text;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF NOT public.meu_plano_admin_edita(_corretor) THEN
    RAISE EXCEPTION 'Só o administrador da imobiliária edita o plano de outra pessoa' USING ERRCODE = '42501';
  END IF;
  -- Mesma validação do carreira_plano_salvar.
  IF _campos IS NULL OR jsonb_typeof(_campos) <> 'object' THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(_campos) LOOP
    _n := _n + 1;
    IF _n > 120 THEN RAISE EXCEPTION 'Campos demais numa gravação' USING ERRCODE = '22023'; END IF;
    IF _k !~ '^[a-z0-9]{1,8}(\.[A-Za-z0-9]{1,12}){0,3}$' THEN
      RAISE EXCEPTION 'Campo inválido: %', left(_k, 40) USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_v) NOT IN ('string', 'boolean', 'number', 'null')
       OR (jsonb_typeof(_v) = 'string' AND length(_v #>> '{}') > 4000) THEN
      RAISE EXCEPTION 'Valor inválido em %', _k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF _n = 0 THEN RETURN NULL; END IF;

  SELECT * INTO _p FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  _antes := CASE WHEN FOUND THEN coalesce(_p.respostas, '{}'::jsonb) ELSE '{}'::jsonb END;
  _depois := jsonb_strip_nulls(_antes || _campos);
  FOR _k IN SELECT jsonb_object_keys(_campos) LOOP
    IF (_antes -> _k) IS DISTINCT FROM (_depois -> _k) THEN
      _dif := _dif || jsonb_build_object(_k, jsonb_build_object('antes', _antes -> _k, 'depois', _depois -> _k));
    END IF;
  END LOOP;
  IF _dif = '{}'::jsonb THEN RETURN _p.updated_at; END IF;   -- nada muda: não grava nem registra

  -- Trava de valores (a mesma da assinatura): o admin não leva um plano limpo para um valor impossível. Plano que
  -- já tinha valor a conferir aceita a edição (é o admin corrigindo); a meta oficial continua recusada até limpar.
  _motivo := public.carreira_plano_trava(_depois);
  IF _motivo IS NOT NULL AND public.carreira_plano_trava(_antes) IS NULL THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: %', _motivo USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.meu_plano_admin_alvo', _corretor::text, true);
  IF _p.id IS NULL THEN
    INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas)
    VALUES (_org, _corretor, _ano, _depois)
    RETURNING updated_at INTO _em;
  ELSE
    UPDATE public.carreira_plano SET respostas = _depois WHERE id = _p.id RETURNING updated_at INTO _em;
  END IF;
  PERFORM set_config('app.meu_plano_admin_alvo', '', true);

  PERFORM public.carreira_plano_admin_log(_org, 'meu_plano_editado_admin', jsonb_build_object(
    'corretor_id', _corretor, 'ano', _ano, 'assinado', _p.assinado_corretor_em IS NOT NULL, 'campos', _dif));
  RETURN _em;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_admin_salvar(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_admin_salvar(uuid, integer, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carreira_plano_admin_usar_meta(_corretor uuid, _ano integer, _comissao numeric,
  _vgv numeric, _vendas integer, _captacoes integer, _substituir boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _org uuid; _ini date; _atual public.minhas_metas%ROWTYPE; _snap jsonb; _p public.carreira_plano%ROWTYPE;
        _motivo text;
BEGIN
  _org := public.meu_plano_org_ok();
  IF _ano IS NULL OR _ano NOT BETWEEN 2026 AND 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  IF NOT public.meu_plano_admin_edita(_corretor) THEN
    RAISE EXCEPTION 'Só o administrador da imobiliária edita o plano de outra pessoa' USING ERRCODE = '42501';
  END IF;
  -- Mesmos limites do carreira_plano_usar_meta.
  IF (_comissao IS NOT NULL AND (_comissao < 0 OR _comissao > 999999999999)) OR
     (_vgv IS NOT NULL AND (_vgv < 0 OR _vgv > 99999999999999)) OR
     (_vendas IS NOT NULL AND _vendas NOT BETWEEN 0 AND 10000) OR
     (_captacoes IS NOT NULL AND _captacoes NOT BETWEEN 0 AND 10000) OR
     num_nulls(_comissao, _vgv, _vendas, _captacoes) = 4 THEN
    RAISE EXCEPTION 'Meta inválida' USING ERRCODE = '22023';
  END IF;
  IF _comissao > 5000000 THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: meta de comissão do ano acima de R$ 5 milhões. Confira as transações e a comissão média.'
      USING ERRCODE = '22023';
  END IF;
  IF _vendas > 1000 THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: mais de 1.000 transações no ano. Confira se não digitou um valor em reais.'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _p FROM public.carreira_plano
   WHERE organization_id = _org AND user_id = _corretor AND ano = _ano FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado' USING ERRCODE = 'P0002'; END IF;
  _motivo := public.carreira_plano_trava(_p.respostas);
  IF _motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Plano com valor fora do limite: %', _motivo USING ERRCODE = '22023';
  END IF;

  _ini := make_date(_ano, 1, 1);
  SELECT * INTO _atual FROM public.minhas_metas
   WHERE organization_id = _org AND user_id = _corretor AND periodo = 'ano' AND inicio = _ini FOR UPDATE;
  IF FOUND AND NOT coalesce(_substituir, false) THEN
    RETURN jsonb_build_object('status', 'existe', 'atual', jsonb_build_object(
      'meta_comissao', _atual.meta_comissao, 'meta_vgv', _atual.meta_vgv,
      'meta_vendas', _atual.meta_vendas, 'meta_captacoes', _atual.meta_captacoes));
  END IF;
  INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao, meta_vgv, meta_vendas, meta_captacoes)
  VALUES (_org, _corretor, 'ano', _ini, round(_comissao, 2), round(_vgv, 2), _vendas, _captacoes)
  ON CONFLICT (organization_id, user_id, periodo, inicio)
  DO UPDATE SET meta_comissao = EXCLUDED.meta_comissao, meta_vgv = EXCLUDED.meta_vgv,
    meta_vendas = EXCLUDED.meta_vendas, meta_captacoes = EXCLUDED.meta_captacoes;
  _snap := jsonb_build_object('meta_comissao', round(_comissao, 2), 'meta_vgv', round(_vgv, 2),
    'meta_vendas', _vendas, 'meta_captacoes', _captacoes);
  PERFORM set_config('app.meu_plano_admin_alvo', _corretor::text, true);
  UPDATE public.carreira_plano SET meta_oficial = _snap, meta_oficial_em = now() WHERE id = _p.id;
  PERFORM set_config('app.meu_plano_admin_alvo', '', true);

  PERFORM public.carreira_plano_admin_log(_org, 'meu_plano_meta_admin', jsonb_build_object(
    'corretor_id', _corretor, 'ano', _ano, 'assinado', _p.assinado_corretor_em IS NOT NULL,
    'meta_oficial_antes', _p.meta_oficial, 'meta_oficial_em_antes', _p.meta_oficial_em,
    'minhas_metas_antes', CASE WHEN _atual.id IS NULL THEN NULL ELSE jsonb_build_object(
      'meta_comissao', _atual.meta_comissao, 'meta_vgv', _atual.meta_vgv,
      'meta_vendas', _atual.meta_vendas, 'meta_captacoes', _atual.meta_captacoes) END,
    'meta_oficial_depois', _snap));
  RETURN jsonb_build_object('status', 'gravada', 'meta', _snap);
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_admin_usar_meta(uuid, integer, numeric, numeric, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_admin_usar_meta(uuid, integer, numeric, numeric, integer, integer, boolean) TO authenticated, service_role;

-- Gatilho do plano assinado: igual ao de 20261227120000 + a exceção do administrador (bloco marcado).
CREATE OR REPLACE FUNCTION public.carreira_plano_trava_assinado()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  -- Em preenchimento, assinando agora ou sendo reaberto: segue normal.
  IF OLD.assinado_corretor_em IS NULL OR NEW.assinado_corretor_em IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.assinado_corretor_em IS DISTINCT FROM OLD.assinado_corretor_em
     OR NEW.trilha IS DISTINCT FROM OLD.trilha
     OR NEW.ativacao_inicio IS DISTINCT FROM OLD.ativacao_inicio
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.ano IS DISTINCT FROM OLD.ano THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = 'PT409';
  END IF;
  -- t_c9b0f633: administrador editando pelo carreira_plano_admin_salvar/_usar_meta (marcador da transação com o
  -- id da pessoa + a mesma regra de papel). O plano continua assinado; o histórico fica em activity_logs.
  IF coalesce(current_setting('app.meu_plano_admin_alvo', true), '') = NEW.user_id::text
     AND public.meu_plano_admin_edita(NEW.user_id) THEN
    RETURN NEW;
  END IF;
  IF public.carreira_plano_parte_travada(NEW.respostas)
        IS DISTINCT FROM public.carreira_plano_parte_travada(OLD.respostas) THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = 'PT409';
  END IF;
  -- shortcut: a meta da assinatura é gravada numa 2ª chamada (o app chama carreira_plano_usar_meta logo depois de
  -- assinar), então vale 1 gravação nos 15 min seguintes; o servidor não confere se a meta bate com as respostas.
  IF (NEW.meta_oficial IS DISTINCT FROM OLD.meta_oficial OR NEW.meta_oficial_em IS DISTINCT FROM OLD.meta_oficial_em)
     AND NOT ((OLD.meta_oficial_em IS NULL OR OLD.meta_oficial_em < OLD.assinado_corretor_em)
              AND now() <= OLD.assinado_corretor_em + interval '15 minutes') THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END $function$;

COMMIT;
