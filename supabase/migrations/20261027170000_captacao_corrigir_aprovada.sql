-- t_9f9f0c6a — "Corrigir dados" na captação APROVADA (pedido de Denis em 27/10/2026, tópico 6238).
-- Antes: para corrigir um dado (ex.: área errada) era preciso "Devolver ao corretor" e aprovar de novo,
-- e a captação saía do mapa e do alerta de vencimento nesse meio tempo.
-- Agora: RPC nova exclusive_corrigir_aprovada. NÃO altera exclusive_save, exclusive_transition nem
-- documentos. A captação continua 'aprovada' (mapa e alerta de vencimento seguem iguais).
--
-- Quem pode (conferido aqui, no banco):
--   * o corretor captador dono da captação (captor_id = auth.uid());
--   * gestor/team leader líder do captador, ou admin/super_admin da organização (exclusive_is_manager),
--     sempre dentro da organização atual (exclusive_can_view + organization_id = current_org_id()).
-- Só captação 'aprovada' e NÃO arquivada.
--
-- O que pode corrigir (lista fechada; qualquer outra chave é recusada):
--   imovel (endereço, complemento, valor, matrícula…), ficha (áreas, quartos, suítes, vagas…) e os
--   dados cadastrais dos proprietários JÁ existentes (sem incluir nem remover proprietário).
-- Fica TRAVADO (continua no fluxo "Devolver"): status, data de assinatura (signed_on e
--   form_data.data_assinatura), prazo/comissão/foro (condicoes), testemunhas, Plano de Marketing,
--   documentos (contrato assinado e PDF gerado nunca são apagados nem regerados), captador
--   (broker_*/captor_id) e unidade (unit_id/template).
--
-- Histórico: exclusive_history action 'corrigida', detail = JSON
--   {"v":1,"por":"corretor"|"gestor","mudancas":[{"grupo","campo","antes","depois"}]}.
--   Dados pessoais do proprietário vão mascarados no histórico (LGPD): CPF/RG ***+3 últimos,
--   telefone ***+4 últimos, e-mail j***@dominio, endereço "(alterado)". Nome, nacionalidade e estado
--   civil aparecem inteiros. O valor completo fica só no formulário.
-- Validação: campos obrigatórios do envio não podem ficar vazios; CPF do proprietário tem de ser
--   válido; ficha até 20 caracteres (igual à tela).
-- Edição simultânea: a tela manda o updated_at que leu; se outra pessoa salvou antes, recusa
--   ("recarregue") em vez de sobrescrever sem aviso.
-- Aviso no sino (sem WhatsApp): corretor dono corrigiu → líder/co-líder da equipe dele e líder da
--   equipe-mãe (mesma regra de is_lead_of; sem nenhum líder ativo: admins da organização); gestor corrigiu → o corretor captador. Quem corrigiu não é avisado.
--   O aviso só cita os NOMES dos campos (sem valores, sem CPF/e-mail). Falha no aviso não desfaz.
-- Venda ativa ligada: a correção é permitida; o retorno informa venda_ativa=true para a tela avisar
--   que a venda NÃO é atualizada automaticamente.
-- Rollback: supabase/rollback/20261027170000_captacao_corrigir_aprovada.sql
BEGIN;

-- Rótulo do campo (mesmos textos de PROPERTY_FIELDS, OWNER_FIELDS e FICHA_CAPTACAO_CAMPOS da tela).
CREATE FUNCTION public.exclusive_correcao_rotulo(_k text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE _k
    -- imóvel
    WHEN 'tipo_imovel' THEN 'Tipo de imóvel'
    WHEN 'endereco' THEN 'Endereço do imóvel'
    WHEN 'complemento' THEN 'Complemento'
    WHEN 'bairro' THEN 'Bairro'
    WHEN 'municipio' THEN 'Município'
    WHEN 'estado' THEN 'Estado'
    WHEN 'classificacao_fiscal_iptu' THEN 'Inscrição / classificação IPTU'
    WHEN 'numero_matricula' THEN 'Número da matrícula'
    WHEN 'cartorio_registro' THEN 'Cartório de registro'
    WHEN 'valor_imovel' THEN 'Valor do imóvel'
    WHEN 'observacoes' THEN 'Observações'
    -- ficha do imóvel
    WHEN 'area_util_m2' THEN 'Área útil (m²)'
    WHEN 'area_construida_m2' THEN 'Área construída (m²)'
    WHEN 'area_terreno_m2' THEN 'Área do terreno (m²)'
    WHEN 'ano_construcao' THEN 'Ano de construção'
    WHEN 'quartos' THEN 'Quartos'
    WHEN 'suites' THEN 'Suítes'
    WHEN 'banheiros' THEN 'Banheiros'
    WHEN 'vagas' THEN 'Vagas'
    -- proprietário
    WHEN 'nome_completo' THEN 'Nome completo'
    WHEN 'rg' THEN 'RG'
    WHEN 'cpf' THEN 'CPF'
    WHEN 'endereco_completo' THEN 'Endereço completo'
    WHEN 'nacionalidade' THEN 'Nacionalidade'
    WHEN 'estado_civil' THEN 'Estado civil'
    WHEN 'email' THEN 'E-mail'
    WHEN 'telefone_1' THEN 'Telefone'
    WHEN 'telefone_2' THEN 'Telefone adicional'
    ELSE _k END
$function$;

-- Compara uma seção (imóvel, ficha ou 1 proprietário) só nas chaves permitidas. Chave ausente ou null
-- no envio = "não mexer". Devolve a seção com SÓ as chaves alteradas trocadas e a lista de mudanças.
-- Valor do histórico: dado pessoal do proprietário mascarado (o formulário guarda o valor completo).
CREATE FUNCTION public.exclusive_correcao_mascara(_k text, _v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN coalesce(_v, '') = '' THEN ''
    WHEN _k IN ('cpf','rg') THEN '***' || right(_v, 3)
    WHEN _k IN ('telefone_1','telefone_2') THEN '***' || right(regexp_replace(_v, '[^0-9]', '', 'g'), 4)
    WHEN _k = 'email' THEN left(_v, 1) || '***' || coalesce(substring(_v FROM '@.*$'), '')
    WHEN _k = 'endereco_completo' THEN '(alterado)'
    ELSE _v END
$function$;

CREATE FUNCTION public.exclusive_correcao_secao(_old jsonb, _new jsonb, _keys text[], _grupo text,
  OUT secao jsonb, OUT mudancas jsonb)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE _k text; _a text; _d text;
BEGIN
  secao := CASE WHEN jsonb_typeof(_old) = 'object' THEN _old ELSE '{}'::jsonb END;
  mudancas := '[]'::jsonb;
  IF _new IS NULL OR jsonb_typeof(_new) = 'null' THEN RETURN; END IF;
  IF jsonb_typeof(_new) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
  FOREACH _k IN ARRAY _keys LOOP
    IF NOT (_new ? _k) OR jsonb_typeof(_new->_k) = 'null' THEN CONTINUE; END IF;
    IF jsonb_typeof(_new->_k) <> 'string' OR length(_new->>_k) > 2000 THEN
      RAISE EXCEPTION 'Dados inválidos';
    END IF;
    _a := coalesce(secao->>_k, '');
    _d := _new->>_k;
    IF _a IS DISTINCT FROM _d THEN
      -- Mesmos obrigatórios do envio (exclusive_required_fields): corrigir não pode esvaziar.
      IF btrim(_d) = '' AND _k IN ('tipo_imovel','endereco','bairro','municipio','estado',
          'classificacao_fiscal_iptu','numero_matricula','cartorio_registro','valor_imovel',
          'nome_completo','rg','cpf','endereco_completo','nacionalidade','estado_civil','email','telefone_1')
        AND _a <> '' THEN
        RAISE EXCEPTION '% não pode ficar vazio', public.exclusive_correcao_rotulo(_k);
      END IF;
      IF _k = 'cpf' AND btrim(_d) <> '' AND NOT public.exclusive_valid_cpf(btrim(_d)) THEN
        RAISE EXCEPTION 'CPF do proprietário inválido';
      END IF;
      IF _grupo = 'Ficha do imóvel' AND length(_d) > 20 THEN RAISE EXCEPTION 'Dados inválidos'; END IF;
      secao := secao || jsonb_build_object(_k, _d);
      mudancas := mudancas || jsonb_build_array(jsonb_build_object(
        'grupo', _grupo, 'campo', public.exclusive_correcao_rotulo(_k),
        'antes', public.exclusive_correcao_mascara(_k, _a),
        'depois', public.exclusive_correcao_mascara(_k, _d)));
    END IF;
  END LOOP;
END $function$;

CREATE FUNCTION public.exclusive_corrigir_aprovada(_id uuid, _dados jsonb, _lido_em timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _c public.exclusive_captures%ROWTYPE;
  _uid uuid := auth.uid();
  _dono boolean; _gestor boolean;
  _form jsonb; _mud jsonb := '[]'::jsonb; _r record;
  _owners jsonb; _novos jsonb; _n integer; _i integer;
  _imovel_keys text[] := ARRAY['tipo_imovel','endereco','complemento','bairro','municipio','estado',
    'classificacao_fiscal_iptu','numero_matricula','cartorio_registro','valor_imovel','observacoes'];
  _ficha_keys text[] := ARRAY['area_util_m2','area_construida_m2','area_terreno_m2','ano_construcao',
    'quartos','suites','banheiros','vagas'];
  _owner_keys text[] := ARRAY['nome_completo','rg','cpf','endereco_completo','nacionalidade',
    'estado_civil','email','telefone_1','telefone_2'];
  _campos text; _titulo text; _msg text; _quem text;
BEGIN
  -- Trava a linha: correções simultâneas esperam e comparam com o valor já gravado pela outra.
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _id AND organization_id = public.current_org_id() FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, _uid) THEN
    RAISE EXCEPTION 'Captação não disponível';
  END IF;
  _dono := _c.captor_id = _uid;
  _gestor := public.exclusive_is_manager(_id, _uid);
  IF NOT (_dono OR _gestor) THEN
    RAISE EXCEPTION 'Só o corretor captador ou o gestor/team leader/admin pode corrigir esta captação';
  END IF;
  IF _c.status <> 'aprovada' OR _c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só captação aprovada e não arquivada pode ser corrigida por aqui';
  END IF;
  -- Outra pessoa salvou depois que a tela carregou: não sobrescreve sem ela ver.
  IF _lido_em IS NOT NULL AND _c.updated_at IS DISTINCT FROM _lido_em THEN
    RAISE EXCEPTION 'A captação foi alterada por outra pessoa. Recarregue a página e corrija de novo.';
  END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR length(_dados::text) > 30000 THEN
    RAISE EXCEPTION 'Dados inválidos';
  END IF;
  -- Lista fechada: status, datas, prazo, documentos, captador, unidade etc. nunca entram aqui.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN ('imovel','ficha','proprietarios')) THEN
    RAISE EXCEPTION 'Este dado não pode ser corrigido por aqui. Use "Devolver ao corretor".';
  END IF;

  _form := _c.form_data;

  SELECT * INTO _r FROM public.exclusive_correcao_secao(_form->'imovel', _dados->'imovel', _imovel_keys, 'Imóvel');
  IF _r.mudancas <> '[]'::jsonb THEN
    _form := jsonb_set(_form, '{imovel}', _r.secao);
    _mud := _mud || _r.mudancas;
  END IF;

  SELECT * INTO _r FROM public.exclusive_correcao_secao(_form->'ficha', _dados->'ficha', _ficha_keys, 'Ficha do imóvel');
  IF _r.mudancas <> '[]'::jsonb THEN
    _form := jsonb_set(_form, '{ficha}', _r.secao);
    _mud := _mud || _r.mudancas;
  END IF;

  -- Proprietários: só os que já existem (os documentos ficam presos à posição de cada um).
  IF _dados ? 'proprietarios' AND jsonb_typeof(_dados->'proprietarios') <> 'null' THEN
    _owners := public.exclusive_owner_list(_c.form_data);
    _n := jsonb_array_length(_owners);
    _novos := _dados->'proprietarios';
    IF jsonb_typeof(_novos) <> 'array' OR jsonb_array_length(_novos) < _n THEN
      RAISE EXCEPTION 'Não é possível remover proprietário pela correção. Use "Devolver ao corretor".';
    END IF;
    -- Posições a mais só são aceitas vazias (a tela pode mandar um 2º em branco).
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_novos) WITH ORDINALITY x(o, i)
      WHERE x.i > _n AND CASE WHEN jsonb_typeof(x.o) = 'null' THEN false
        WHEN jsonb_typeof(x.o) <> 'object' THEN true
        ELSE EXISTS (SELECT 1 FROM jsonb_each(x.o) e
                     WHERE jsonb_typeof(e.value) <> 'string' OR btrim(e.value #>> '{}') <> '') END)
    THEN
      RAISE EXCEPTION 'Não é possível incluir proprietário pela correção. Use "Devolver ao corretor".';
    END IF;
    FOR _i IN 1.._n LOOP
      SELECT * INTO _r FROM public.exclusive_correcao_secao(_owners->(_i - 1), _novos->(_i - 1),
        _owner_keys, 'Proprietário ' || _i);
      CONTINUE WHEN _r.mudancas = '[]'::jsonb;
      IF _i = 1 THEN _form := jsonb_set(_form, '{proprietario_1}', _r.secao);
      ELSIF _i = 2 THEN _form := jsonb_set(_form, '{proprietario_2}', _r.secao);
      ELSE _form := jsonb_set(_form, ARRAY['proprietarios_extras', (_i - 3)::text], _r.secao);
      END IF;
      _mud := _mud || _r.mudancas;
    END LOOP;
  END IF;

  IF jsonb_array_length(_mud) = 0 THEN RAISE EXCEPTION 'Nenhuma alteração para salvar'; END IF;
  IF length(_form::text) > 30000 THEN RAISE EXCEPTION 'Dados inválidos'; END IF;

  -- Só form_data muda: status, signed_on, captador, unidade e documentos ficam como estão.
  UPDATE public.exclusive_captures SET form_data = _form, updated_at = now() WHERE id = _id;

  INSERT INTO public.exclusive_history(capture_id, actor_id, action, detail)
    VALUES (_id, _uid, 'corrigida', jsonb_build_object('v', 1,
      'por', CASE WHEN _dono THEN 'corretor' ELSE 'gestor' END, 'mudancas', _mud)::text);

  -- Aviso no sino (sem WhatsApp). Só nomes de campos; nunca desfaz a correção.
  BEGIN
    SELECT string_agg(DISTINCT m->>'campo', ', ') INTO _campos FROM jsonb_array_elements(_mud) m;
    SELECT nullif(btrim(p.nome), '') INTO _quem FROM public.profiles p WHERE p.id = _uid;
    _titulo := 'Captação #' || upper(left(_id::text, 8)) || ' corrigida depois da aprovação';
    _msg := coalesce(_quem, CASE WHEN _dono THEN 'O corretor' ELSE 'O gestor' END)
      || ' corrigiu: ' || coalesce(_campos, 'dados') || '. A captação continua aprovada.';
    WITH ativos AS (
      -- Só perfis ativos da mesma organização, nunca quem corrigiu.
      SELECT p.id FROM public.profiles p
       WHERE p.organization_id = _c.organization_id AND p.ativo IS NOT FALSE AND p.id IS DISTINCT FROM _uid
    ), lideres AS (
      -- Líder da equipe, líder da equipe-mãe (como is_lead_of) e co-líderes da equipe.
      SELECT x.id FROM (
        SELECT t.lider_id AS id FROM public.team_members tm
          JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
         WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
        UNION
        SELECT pt.lider_id FROM public.team_members tm
          JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
          JOIN public.teams pt ON pt.id = t.parent_team_id AND pt.organization_id = _c.organization_id
         WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
        UNION
        SELECT cl.user_id FROM public.team_members tm
          JOIN public.team_co_leaders cl ON cl.team_id = tm.team_id AND cl.organization_id = _c.organization_id
         WHERE tm.organization_id = _c.organization_id AND tm.membro_id = _c.captor_id
      ) x WHERE x.id IN (SELECT id FROM ativos)
    ), admins AS (
      SELECT ur.user_id AS id FROM public.user_roles ur
       WHERE ur.organization_id = _c.organization_id AND ur.role = 'admin'::public.app_role
         AND ur.user_id IN (SELECT id FROM ativos)
    ), alvo AS (
      SELECT id FROM lideres WHERE _dono
      UNION SELECT id FROM admins WHERE _dono AND NOT EXISTS (SELECT 1 FROM lideres)
      UNION SELECT _c.captor_id WHERE NOT _dono AND _c.captor_id IN (SELECT id FROM ativos)
    )
    INSERT INTO public.notifications (user_id, organization_id, exclusive_capture_id, tipo, titulo, mensagem)
      SELECT a.id, _c.organization_id, _id, 'captacao_corrigida', left(_titulo, 200), left(_msg, 500)
        FROM alvo a WHERE a.id IS NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'exclusive_corrigir_aprovada: aviso não gravado (%)', SQLSTATE;
  END;

  RETURN jsonb_build_object('alterados', jsonb_array_length(_mud),
    'venda_ativa', public.exclusive_venda_ativa(_id) IS NOT NULL);
END $function$;

-- Dono e permissões (mesmo dono das demais RPCs da captação) ------------------------------------
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_correcao_rotulo(text) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_correcao_mascara(text, text) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_correcao_secao(jsonb, jsonb, text[], text) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_correcao_rotulo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exclusive_correcao_mascara(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_correcao_mascara(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.exclusive_correcao_secao(jsonb, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_correcao_rotulo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_correcao_secao(jsonb, jsonb, text[], text) TO service_role;
REVOKE ALL ON FUNCTION public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz) TO authenticated, service_role;

COMMIT;
