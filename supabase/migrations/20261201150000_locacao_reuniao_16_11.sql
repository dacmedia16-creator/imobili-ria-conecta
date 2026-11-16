-- Locação — pedidos da reunião de 16/11 (itens 1 a 8 aprovados por Denis no tópico 6238). Cartão t_8f09d406.
-- Plano: t_55cd3848. CONSTRUÇÃO EM TESTE: aplicar em produção só com o "pode publicar" de Denis.
--
-- Rollback: supabase/rollback/20261201150000_locacao_reuniao_16_11.sql
-- Teste:    supabase/tests/run-locacao-reuniao.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  1) Complemento (bloco/apto) do imóvel: chave nova "complemento" na ficha (locacao_ficha_ok); aparece nas listas.
--  2) Tipo do imóvel escolhido ao ABRIR a locação: condomínio, casa de rua ou comercial (locacoes.imovel_tipo).
--     A modalidade (residencial/comercial) passa a sair do tipo. Condomínio ganha a parte "Condomínio" no checklist com
--     "CND do condomínio (opcional)", que não trava nada. A pré-aprovação passa a pedir o tipo.
--  3) Comprovante de renda do locatário: continua no checklist do locatário em todas as garantias (seguro-fiança
--     inclusive) e o banco garante o item mesmo que a lista da imobiliária o tire. Sem campo de valor (decisão de Denis).
--  4) Prazo (meses), dia de vencimento e moradores passam a travar o envio da Documentação em TODAS as garantias.
--     O "Salvar dados do contrato" continua. O prazo vem preenchido na tela (30 residencial / 36 comercial).
--  5) Equipe do corretor gravada NA LOCAÇÃO no momento da abertura: equipe, Gestor e Team Leader (id + nome). Não muda
--     depois, mesmo que o corretor troque de equipe. Locações abertas antes ficam sem esse registro.
--  6) Lançamento para comissão (Fernanda, papel vistoria): captador, locador, gestor, team leader, aluguel, taxa e
--     parceria (nenhuma / RE/MAX / externa). Tabela locacao_lancamentos. Não trava a entrega das chaves.
--  7) Aviso por WhatsApp ao corretor: fila locacao_avisos com chave única por evento (sem duplicar), gerada por gatilho
--     em minuta enviada, pendência cobrada, minuta em ajuste, devolução da gestora e andamento "aguardando corretor".
--     Quem envia é o servidor do site (mesmo canal ZionTalk das vendas), no máximo 5 por chamada, só avisos de 24 h.
--  8) Clientes da locação (locatário, proprietário, fiador e cônjuges) gravados no cadastro de clientes das vendas,
--     casando pelo CPF/CNPJ dentro da imobiliária (sem duplicar; só completa campo vazio). Ligação em locacao_clientes.
--     Sem retroativo: vale para o que for salvo depois da publicação.
-- Funções redefinidas (o rollback devolve o texto exato anterior): locacao_criar (ganha _imovel_tipo), locacao_ficha_ok,
--   locacao_partes, locacao_docs_grupo, locacao_contrato_faltando, locacao_pre_faltando, locacao_lista.
-- Não toca em locacao_config (nenhuma linha) nem em locações existentes (sem preenchimento retroativo).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Colunas novas ------------------------------------------------------------------------------------------------
ALTER TABLE public.locacoes
  ADD COLUMN imovel_tipo text CONSTRAINT locacoes_imovel_tipo_check CHECK (imovel_tipo IN ('condominio', 'casa', 'comercial')),
  ADD COLUMN equipe_id uuid,
  ADD COLUMN equipe_nome text,
  ADD COLUMN equipe_gestor_id uuid,
  ADD COLUMN equipe_gestor_nome text,
  ADD COLUMN equipe_tl_id uuid,
  ADD COLUMN equipe_tl_nome text,
  ADD COLUMN equipe_gravada_em timestamptz;
CREATE INDEX locacoes_equipe_idx ON public.locacoes (organization_id, equipe_id);

CREATE FUNCTION public.locacao_imovel_tipo_rotulo(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE _t WHEN 'condominio' THEN 'condomínio (apto ou condomínio fechado)' WHEN 'casa' THEN 'casa de rua'
    WHEN 'comercial' THEN 'comercial' ELSE coalesce(_t, '') END
$$;

-- 2) Equipe do corretor na abertura -------------------------------------------------------------------------------
-- Equipe: a equipe em que o corretor é membro; se ele mesmo lidera uma equipe (e não é membro de outra), essa.
-- Team Leader: o líder da equipe se tiver o papel Team Leader; senão o 1º líder auxiliar com esse papel.
-- Gestor: quem tem o papel Gestor, nesta ordem: líder da equipe, líderes auxiliares, líder da equipe-mãe. Prefere quem
--   não é administrador e quem não é o próprio Team Leader; se não houver outro, pode ser o mesmo nome.
CREATE FUNCTION public.locacao_equipe_do_corretor(_uid uuid, _org uuid)
RETURNS TABLE (equipe_id uuid, equipe_nome text, gestor_id uuid, gestor_nome text, tl_id uuid, tl_nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _t public.teams; _cand uuid[]; _tl uuid; _ge uuid;
BEGIN
  IF _uid IS NULL OR _org IS NULL THEN RETURN; END IF;
  SELECT t.* INTO _t FROM public.team_members m JOIN public.teams t ON t.id = m.team_id
   WHERE m.membro_id = _uid AND m.organization_id = _org AND t.organization_id = _org
   ORDER BY m.created_at DESC LIMIT 1;
  IF _t.id IS NULL THEN
    SELECT t.* INTO _t FROM public.teams t WHERE t.lider_id = _uid AND t.organization_id = _org ORDER BY t.created_at LIMIT 1;
  END IF;
  IF _t.id IS NULL THEN RETURN; END IF;
  _cand := ARRAY[_t.lider_id]
    || coalesce((SELECT array_agg(c.user_id ORDER BY c.created_at, c.user_id) FROM public.team_co_leaders c
                  WHERE c.team_id = _t.id), ARRAY[]::uuid[])
    || coalesce((SELECT array_agg(p.lider_id) FROM public.teams p WHERE p.id = _t.parent_team_id AND p.organization_id = _org),
                ARRAY[]::uuid[]);
  SELECT x.u INTO _tl FROM unnest(_cand) WITH ORDINALITY x(u, n)
   WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = x.u AND r.organization_id = _org AND r.role = 'team_leader')
   ORDER BY x.n LIMIT 1;
  SELECT x.u INTO _ge FROM unnest(_cand) WITH ORDINALITY x(u, n)
   WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = x.u AND r.organization_id = _org AND r.role = 'gestor')
   ORDER BY EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = x.u AND r.organization_id = _org
                     AND r.role IN ('admin', 'super_admin', 'staff')),
            x.u IS NOT DISTINCT FROM _tl, x.n
   LIMIT 1;
  RETURN QUERY SELECT _t.id, _t.nome, _ge, (SELECT p.nome FROM public.profiles p WHERE p.id = _ge),
    _tl, (SELECT p.nome FROM public.profiles p WHERE p.id = _tl);
END $$;

-- Na criação grava a equipe (uma vez só) e, com o tipo do imóvel, a modalidade. Depois disso a equipe não muda.
CREATE FUNCTION public.locacao_trg_abertura() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _e record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO _e FROM public.locacao_equipe_do_corretor(NEW.corretor_id, NEW.organization_id);
    NEW.equipe_id := _e.equipe_id; NEW.equipe_nome := _e.equipe_nome;
    NEW.equipe_gestor_id := _e.gestor_id; NEW.equipe_gestor_nome := _e.gestor_nome;
    NEW.equipe_tl_id := _e.tl_id; NEW.equipe_tl_nome := _e.tl_nome;
    NEW.equipe_gravada_em := now();
  ELSE
    NEW.equipe_id := OLD.equipe_id; NEW.equipe_nome := OLD.equipe_nome;
    NEW.equipe_gestor_id := OLD.equipe_gestor_id; NEW.equipe_gestor_nome := OLD.equipe_gestor_nome;
    NEW.equipe_tl_id := OLD.equipe_tl_id; NEW.equipe_tl_nome := OLD.equipe_tl_nome;
    NEW.equipe_gravada_em := OLD.equipe_gravada_em;
  END IF;
  IF NEW.imovel_tipo IS NOT NULL THEN
    NEW.tipo := CASE WHEN NEW.imovel_tipo = 'comercial' THEN 'comercial' ELSE 'residencial' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER locacao_00_abertura BEFORE INSERT OR UPDATE ON public.locacoes
  FOR EACH ROW EXECUTE FUNCTION public.locacao_trg_abertura();

-- 3) Abrir a locação com o tipo do imóvel (sem tipo continua aceito: a pré-aprovação cobra antes de enviar) ----------
DROP FUNCTION public.locacao_criar();
CREATE FUNCTION public.locacao_criar(_imovel_tipo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _t text := nullif(btrim(coalesce(_imovel_tipo, '')), '');
BEGIN
  IF NOT (public.has_any_role(auth.uid(), ARRAY['corretor', 'gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[])
          OR public.so_locacao_ativo(auth.uid())) THEN
    RAISE EXCEPTION 'Só corretores criam locações.' USING ERRCODE = '42501';
  END IF;
  IF _t IS NOT NULL AND _t NOT IN ('condominio', 'casa', 'comercial') THEN
    RAISE EXCEPTION 'Tipo de imóvel inválido.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.locacoes (organization_id, corretor_id, imovel_tipo) VALUES (_org, auth.uid(), _t) RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise iniciada'
    || coalesce(' — imóvel: ' || public.locacao_imovel_tipo_rotulo(_t), ''));
  RETURN jsonb_build_object('id', _l.id);
END $$;
REVOKE ALL ON FUNCTION public.locacao_criar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_criar(text) TO authenticated;

-- Trocar o tipo ainda na pré-aprovação (o corretor pode ter escolhido errado ao abrir).
CREATE FUNCTION public.locacao_imovel_tipo_definir(_id uuid, _tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _t text := nullif(btrim(coalesce(_tipo, '')), '');
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _t IS NULL OR _t NOT IN ('condominio', 'casa', 'comercial') THEN
    RAISE EXCEPTION 'Escolha condomínio, casa de rua ou comercial.' USING ERRCODE = '22023';
  END IF;
  IF _l.imovel_tipo IS NOT DISTINCT FROM _t THEN RETURN jsonb_build_object('ok', true, 'tipo', _l.tipo); END IF;
  UPDATE public.locacoes SET imovel_tipo = _t, atualizado_em = now() WHERE id = _id RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Tipo do imóvel: ' || public.locacao_imovel_tipo_rotulo(_t));
  RETURN jsonb_build_object('ok', true, 'tipo', _l.tipo);
END $$;
REVOKE ALL ON FUNCTION public.locacao_imovel_tipo_definir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_imovel_tipo_definir(uuid, text) TO authenticated;

-- 4) Ficha: complemento (bloco/apto) ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_ficha_ok(_f jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _e record; _x record; _t text;
BEGIN
  IF _f IS NULL OR jsonb_typeof(_f) <> 'object' THEN RETURN false; END IF;
  FOR _e IN SELECT key, value FROM jsonb_each(_f) LOOP
    CONTINUE WHEN jsonb_typeof(_e.value) = 'null';
    _t := CASE WHEN jsonb_typeof(_e.value) = 'string' THEN _e.value #>> '{}' END;
    IF _e.key = 'imovel_id' THEN
      IF _t IS NULL OR length(_t) > 40 THEN RETURN false; END IF;
    ELSIF _e.key = 'mobilia' THEN
      IF _t IS NULL OR _t NOT IN ('mobiliado', 'semi', 'sem') THEN RETURN false; END IF;
    ELSIF _e.key = 'metragem' THEN
      IF jsonb_typeof(_e.value) <> 'number' OR (_e.value)::text::numeric <= 0 OR (_e.value)::text::numeric >= 1000000 THEN
        RETURN false;
      END IF;
    ELSIF _e.key IN ('locatario_pessoa', 'proprietario_pessoa', 'fiador_pessoa') THEN
      IF _t IS NULL OR _t NOT IN ('pf', 'pj') THEN RETURN false; END IF;
    ELSIF _e.key IN ('locatario_endereco', 'garantia_outra') THEN
      IF _t IS NULL OR length(_t) > 300 THEN RETURN false; END IF;
    ELSIF _e.key = 'complemento' THEN
      -- t_8f09d406: bloco/apto do imóvel locado.
      IF _t IS NULL OR length(_t) > 100 THEN RETURN false; END IF;
    ELSIF _e.key = 'observacoes' THEN
      IF _t IS NULL OR length(_t) > 2000 THEN RETURN false; END IF;
    ELSIF _e.key = 'cep' THEN
      IF _t IS NULL OR _t !~ '^[0-9]{5}-?[0-9]{3}$' THEN RETURN false; END IF;
    ELSIF _e.key = 'proprietario' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'telefone', 'email') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200 THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSIF _e.key = 'fiador' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'cpf', 'renda', 'matricula') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200
           OR (_x.key = 'renda' AND coalesce(_x.value #>> '{}', '') <> '' AND NOT public.locacao_renda_ok(_x.value #>> '{}')) THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 5) Pré-aprovação: o tipo do imóvel passa a ser pedido -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_pre_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE _f text[] := ARRAY[]::text[];
BEGIN
  -- t_8f09d406: tipo do imóvel (condomínio, casa de rua ou comercial).
  IF _l.imovel_tipo IS NULL THEN _f := array_append(_f, 'tipo do imóvel'); END IF;
  IF coalesce(_l.ficha->>'cep', '') !~ '^[0-9]{5}-?[0-9]{3}$' THEN _f := array_append(_f, 'CEP'); END IF;
  IF length(btrim(coalesce(_l.endereco, ''))) < 8 THEN _f := array_append(_f, 'endereço do imóvel'); END IF;
  IF _l.aluguel IS NULL THEN _f := array_append(_f, 'aluguel'); END IF;
  _f := _f || public.locacao_pre_parte_faltando('locatario', _l.garantia, _l.candidato);
  _f := _f || public.locacao_pre_parte_faltando('fiador', _l.garantia, _l.ficha->'fiador');
  IF _l.garantia = 'outras' AND length(btrim(coalesce(_l.ficha->>'garantia_outra', ''))) < 3 THEN
    _f := array_append(_f, 'observação da garantia');
  END IF;
  RETURN _f;
END $$;

-- 6) Checklist: parte "Condomínio" (CND opcional) e comprovante de renda garantido ------------------------------
CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
RETURNS TABLE (ordem integer, parte text, grupo text, rotulo text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE WHEN _l.garantia = 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          ELSE 'Garantia — ' || public.locacao_garantia_rotulo(_l.garantia) END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END),
    -- t_8f09d406: imóvel em condomínio pede a CND do condomínio (opcional, não trava).
    (4, 'condominio', 'condominio', 'Condomínio')
  ) v(ordem, parte, grupo, rotulo)
  -- t_d3e1c29f: seguro-fiança não pede documento na Documentação (apólice vai em "Seguro e condomínio").
  WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')
    AND (v.ordem <> 4 OR _l.imovel_tipo = 'condominio')
$$;

CREATE OR REPLACE FUNCTION public.locacao_docs_grupo(_org uuid, _grupo text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _j jsonb; _v jsonb; _r text[];
BEGIN
  -- t_8f09d406: lista fixa do condomínio (fora das Regras); o "(opcional)" faz o item não travar.
  IF _grupo = 'condominio' THEN RETURN ARRAY['CND do condomínio (opcional)']; END IF;
  _j := (public.locacao_cfg(_org)).documentos;
  _v := _j->_grupo;
  IF right(_grupo, 3) = '_pj' AND (_v IS NULL OR jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) = 0) THEN
    _v := _j->left(_grupo, -3);
  END IF;
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN
    _r := ARRAY[]::text[];
  ELSE
    _r := coalesce((SELECT array_agg(x ORDER BY n) FROM jsonb_array_elements_text(_v) WITH ORDINALITY t(x, n)), ARRAY[]::text[]);
  END IF;
  -- t_8f09d406: comprovante de renda do locatário sempre obrigatório (qualquer garantia, inclusive seguro-fiança).
  IF _grupo = 'locatario' AND NOT EXISTS (SELECT 1 FROM unnest(_r) x WHERE x ~* 'renda' AND NOT public.locacao_doc_opcional(x)) THEN
    _r := _r || 'Comprovante de renda do locatário'::text;
  END IF;
  RETURN _r;
END $$;

-- 7) Dados do contrato: prazo, vencimento e moradores obrigatórios em todas as garantias -----------------------------
CREATE OR REPLACE FUNCTION public.locacao_contrato_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _v jsonb; _f text[] := ARRAY[]::text[]; _p record; _i record; _x text;
BEGIN
  _v := public.locacao_contrato_valores(_l);
  IF public.locacao_exige_contrato(_l) THEN
    FOR _p IN SELECT * FROM (VALUES (1, 'loc', 'do locatário'), (2, 'prop', 'do proprietário'), (3, 'fia', 'do fiador'))
               AS t(n, pre, rot) ORDER BY n LOOP
      FOR _i IN SELECT * FROM (VALUES (1, 'nome', 'nome'), (2, 'cpf', 'CPF'), (3, 'rg', 'RG'), (4, 'nacionalidade', 'nacionalidade'),
                  (5, 'estado_civil', 'estado civil'), (6, 'profissao', 'profissão'), (7, 'endereco', 'endereço'))
                 AS t(n, k, nome) ORDER BY n LOOP
        _x := btrim(coalesce(_v->>(_p.pre || '_' || _i.k), ''));
        IF (_i.k = 'cpf' AND length(regexp_replace(_x, '[^0-9]', '', 'g')) <> 11) OR (_i.k <> 'cpf' AND _x = '') THEN
          _f := array_append(_f, _i.nome || ' ' || _p.rot);
        END IF;
      END LOOP;
      IF _p.pre <> 'loc' AND public.locacao_casado(_v->>(_p.pre || '_estado_civil')) THEN
        IF btrim(coalesce(_v->>(_p.pre || '_conj_nome'), '')) = '' THEN
          _f := array_append(_f, 'nome do cônjuge ' || _p.rot);
        END IF;
        IF length(regexp_replace(coalesce(_v->>(_p.pre || '_conj_cpf'), ''), '[^0-9]', '', 'g')) <> 11 THEN
          _f := array_append(_f, 'CPF do cônjuge ' || _p.rot);
        END IF;
      END IF;
    END LOOP;
    FOR _i IN SELECT * FROM (VALUES (1, 'fia_matricula', 'matrícula do imóvel do fiador'), (2, 'fia_cartorio', 'cartório do imóvel do fiador'),
                (3, 'imv_inscricao', 'inscrição municipal do imóvel'), (4, 'imv_energia', 'código de energia'),
                (5, 'imv_agua', 'código de água'), (6, 'imv_vagas', 'vagas de garagem (ou "não possui")'),
                (7, 'prazo_meses', 'prazo (meses)'), (8, 'inicio', 'início do contrato'),
                (9, 'dia_vencimento', 'dia de vencimento')) AS t(n, k, nome) ORDER BY n LOOP
      IF btrim(coalesce(_v->>_i.k, '')) = '' THEN _f := array_append(_f, _i.nome); END IF;
    END LOOP;
  ELSE
    -- t_8f09d406: nas demais garantias (e no comercial) só prazo e vencimento, além dos moradores abaixo.
    FOR _i IN SELECT * FROM (VALUES (1, 'prazo_meses', 'prazo (meses)'), (2, 'dia_vencimento', 'dia de vencimento'))
               AS t(n, k, nome) ORDER BY n LOOP
      IF btrim(coalesce(_v->>_i.k, '')) = '' THEN _f := array_append(_f, _i.nome); END IF;
    END LOOP;
  END IF;
  -- t_8f09d406: moradores obrigatórios em todas as garantias.
  IF btrim(coalesce(_v->>'moradores', '')) = '' THEN _f := array_append(_f, 'moradores'); END IF;
  RETURN _f;
END $$;

-- 8) Lista: complemento e o lançamento da Fernanda (a ficha continua fora da lista) -------------------------------
CREATE TABLE public.locacao_lancamentos (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  captador_id uuid,
  locador text CONSTRAINT locacao_lancamentos_locador_check CHECK (locador IS NULL OR length(locador) BETWEEN 2 AND 200),
  gestor_id uuid,
  team_leader_id uuid,
  aluguel numeric(12, 2) NOT NULL CONSTRAINT locacao_lancamentos_aluguel_check CHECK (aluguel > 0 AND aluguel < 10000000),
  taxa_adm numeric(5, 2) NOT NULL CONSTRAINT locacao_lancamentos_taxa_check CHECK (taxa_adm > 0 AND taxa_adm <= 30),
  parceria text NOT NULL DEFAULT 'nenhuma' CONSTRAINT locacao_lancamentos_parceria_check
    CHECK (parceria IN ('nenhuma', 'remax', 'externa')),
  parceria_unidade text CONSTRAINT locacao_lancamentos_unidade_check CHECK (length(parceria_unidade) <= 200),
  parceria_corretor text CONSTRAINT locacao_lancamentos_pcorretor_check CHECK (length(parceria_corretor) <= 200),
  parceria_imobiliaria text CONSTRAINT locacao_lancamentos_pimob_check CHECK (length(parceria_imobiliaria) <= 200),
  observacao text CONSTRAINT locacao_lancamentos_obs_check CHECK (length(observacao) <= 1000),
  lancado_por uuid,
  lancado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.locacao_lancamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_lancamentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_lancamentos TO service_role;

CREATE OR REPLACE FUNCTION public.locacao_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg((public.locacao_json(l) - 'ficha') || jsonb_build_object(
      -- t_8f09d406: complemento (bloco/apto) e valores lançados pela Fernanda para a aba Comissão.
      'complemento', nullif(btrim(coalesce(l.ficha->>'complemento', '')), ''),
      'lancamento', (SELECT jsonb_build_object('aluguel', x.aluguel, 'taxa_adm', x.taxa_adm, 'parceria', x.parceria,
          'atualizado_em', x.atualizado_em) FROM public.locacao_lancamentos x WHERE x.locacao_id = l.id))
      ORDER BY l.etapa_desde), '[]')
            FROM public.locacoes l WHERE l.organization_id = _org AND public.locacao_pode_ver(l));
END $$;

-- 9) Lançamento para comissão (Fernanda = papel vistoria; admin também) --------------------------------------------
CREATE FUNCTION public.locacao_lancamento_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _x public.locacao_lancamentos;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _x FROM public.locacao_lancamentos WHERE locacao_id = _id;
  RETURN jsonb_build_object(
    'pode_editar', _l.situacao = 'ativa' AND _l.etapa IN ('pos_assinatura', 'chaves', 'comissao')
                   AND public.locacao_tem_papel(auth.uid(), 'vistoria'),
    'lancado', _x.locacao_id IS NOT NULL,
    'valores', CASE WHEN _x.locacao_id IS NOT NULL THEN jsonb_build_object(
        'captador_id', _x.captador_id, 'locador', _x.locador, 'gestor_id', _x.gestor_id, 'team_leader_id', _x.team_leader_id,
        'aluguel', _x.aluguel, 'taxa_adm', _x.taxa_adm, 'parceria', _x.parceria, 'parceria_unidade', _x.parceria_unidade,
        'parceria_corretor', _x.parceria_corretor, 'parceria_imobiliaria', _x.parceria_imobiliaria, 'observacao', _x.observacao)
      ELSE jsonb_build_object(
        'captador_id', _l.captador_id, 'locador', nullif(btrim(coalesce(_l.ficha#>>'{proprietario,nome}', '')), ''),
        'gestor_id', _l.equipe_gestor_id, 'team_leader_id', _l.equipe_tl_id, 'aluguel', _l.aluguel, 'taxa_adm', _l.taxa_adm,
        'parceria', CASE WHEN _l.parceria THEN 'externa' ELSE 'nenhuma' END) END,
    'nomes', jsonb_build_object(
      'captador', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.captador_id, CASE WHEN _x.locacao_id IS NULL THEN _l.captador_id END)),
      'gestor', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.gestor_id, CASE WHEN _x.locacao_id IS NULL THEN _l.equipe_gestor_id END)),
      'team_leader', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.team_leader_id, CASE WHEN _x.locacao_id IS NULL THEN _l.equipe_tl_id END))),
    'lancado_por_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.atualizado_por, _x.lancado_por)),
    'atualizado_em', _x.atualizado_em);
END $$;
REVOKE ALL ON FUNCTION public.locacao_lancamento_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_ler(uuid) TO authenticated;

CREATE FUNCTION public.locacao_lancamento_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d jsonb := coalesce(_dados, '{}'::jsonb);
  _cap uuid; _ge uuid; _tl uuid; _alu numeric; _tx numeric; _par text; _uni text; _pco text; _pim text; _loc text; _obs text;
  _novo boolean; _k text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves', 'comissao'], 'vistoria');
  IF jsonb_typeof(_d) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key NOT IN
     ('captador_id', 'locador', 'gestor_id', 'team_leader_id', 'aluguel', 'taxa_adm', 'parceria', 'parceria_unidade',
      'parceria_corretor', 'parceria_imobiliaria', 'observacao') OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOREACH _k IN ARRAY ARRAY['captador_id', 'gestor_id', 'team_leader_id'] LOOP
    IF nullif(_d->>_k, '') IS NOT NULL AND NOT public.locacao_membro_ativo((_d->>_k)::uuid, _l.organization_id) THEN
      RAISE EXCEPTION 'Pessoa fora desta imobiliária.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  _cap := nullif(_d->>'captador_id', '')::uuid; _ge := nullif(_d->>'gestor_id', '')::uuid; _tl := nullif(_d->>'team_leader_id', '')::uuid;
  _alu := nullif(_d->>'aluguel', '')::numeric; _tx := nullif(_d->>'taxa_adm', '')::numeric;
  _par := coalesce(nullif(_d->>'parceria', ''), 'nenhuma');
  _loc := nullif(btrim(coalesce(_d->>'locador', '')), ''); _obs := nullif(btrim(coalesce(_d->>'observacao', '')), '');
  _uni := nullif(btrim(coalesce(_d->>'parceria_unidade', '')), ''); _pco := nullif(btrim(coalesce(_d->>'parceria_corretor', '')), '');
  _pim := nullif(btrim(coalesce(_d->>'parceria_imobiliaria', '')), '');
  IF _alu IS NULL OR _alu <= 0 THEN RAISE EXCEPTION 'Informe o aluguel.' USING ERRCODE = '22023'; END IF;
  IF _tx IS NULL OR _tx <= 0 OR _tx > 30 THEN RAISE EXCEPTION 'Informe a taxa de administração (até 30%%).' USING ERRCODE = '22023'; END IF;
  IF _par NOT IN ('nenhuma', 'remax', 'externa') THEN RAISE EXCEPTION 'Parceria inválida.' USING ERRCODE = '22023'; END IF;
  IF _par = 'remax' AND (length(coalesce(_uni, '')) < 2 OR length(coalesce(_pco, '')) < 2) THEN
    RAISE EXCEPTION 'Parceria RE/MAX: informe a unidade e o corretor parceiro.' USING ERRCODE = '22023';
  END IF;
  IF _par = 'externa' AND length(coalesce(_pim, '')) < 2 THEN
    RAISE EXCEPTION 'Parceria externa: informe a imobiliária parceira.' USING ERRCODE = '22023';
  END IF;
  IF _par <> 'remax' THEN _uni := NULL; _pco := NULL; END IF;
  IF _par <> 'externa' THEN _pim := NULL; END IF;
  _novo := NOT EXISTS (SELECT 1 FROM public.locacao_lancamentos WHERE locacao_id = _id);
  INSERT INTO public.locacao_lancamentos AS x (locacao_id, organization_id, captador_id, locador, gestor_id, team_leader_id, aluguel,
    taxa_adm, parceria, parceria_unidade, parceria_corretor, parceria_imobiliaria, observacao, lancado_por, atualizado_por)
  VALUES (_id, _l.organization_id, _cap, _loc, _ge, _tl, _alu, _tx, _par, _uni, _pco, _pim, _obs, auth.uid(), auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET captador_id = EXCLUDED.captador_id, locador = EXCLUDED.locador,
    gestor_id = EXCLUDED.gestor_id, team_leader_id = EXCLUDED.team_leader_id, aluguel = EXCLUDED.aluguel, taxa_adm = EXCLUDED.taxa_adm,
    parceria = EXCLUDED.parceria, parceria_unidade = EXCLUDED.parceria_unidade, parceria_corretor = EXCLUDED.parceria_corretor,
    parceria_imobiliaria = EXCLUDED.parceria_imobiliaria, observacao = EXCLUDED.observacao,
    atualizado_por = auth.uid(), atualizado_em = now();
  PERFORM public.locacao_evento(_l, 'vistoria', 'Lançamento para comissão ' || CASE WHEN _novo THEN 'registrado' ELSE 'atualizado' END
    || ': aluguel ' || public.locacao_fin_brl(_alu) || ', taxa ' || trim(to_char(_tx, 'FM990.99')) || '%, parceria '
    || CASE _par WHEN 'nenhuma' THEN 'nenhuma' WHEN 'remax' THEN 'RE/MAX (' || _uni || ')' ELSE 'externa (' || _pim || ')' END);
  RETURN jsonb_build_object('ok', true, 'novo', _novo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido no lançamento' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) TO authenticated;

-- 10) Avisos por WhatsApp ao corretor (fila; quem envia é o servidor do site) -------------------------------------
CREATE TABLE public.locacao_avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  evento text NOT NULL CONSTRAINT locacao_avisos_evento_check
    CHECK (evento IN ('minuta_enviada', 'pendencia', 'ajuste', 'devolvida', 'andamento')),
  chave text NOT NULL CONSTRAINT locacao_avisos_chave_key UNIQUE,
  destinatario_id uuid NOT NULL,
  texto text NOT NULL CONSTRAINT locacao_avisos_texto_check CHECK (length(texto) BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'pendente' CONSTRAINT locacao_avisos_status_check
    CHECK (status IN ('pendente', 'enviando', 'enviado', 'falhou', 'incerto', 'ignorado', 'expirado')),
  tentativas integer NOT NULL DEFAULT 0,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  reservado_em timestamptz,
  enviado_em timestamptz
);
CREATE INDEX locacao_avisos_fila_idx ON public.locacao_avisos (locacao_id, status, criado_em);
ALTER TABLE public.locacao_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_avisos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_avisos TO service_role;

CREATE FUNCTION public.locacao_aviso_novo(_l public.locacoes, _evento text, _chave text, _texto text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  INSERT INTO public.locacao_avisos (organization_id, locacao_id, evento, chave, destinatario_id, texto)
  SELECT _l.organization_id, _l.id, _evento, _chave, _l.corretor_id, left(btrim(_texto), 600)
   WHERE _l.situacao = 'ativa' AND auth.uid() IS DISTINCT FROM _l.corretor_id AND length(btrim(coalesce(_texto, ''))) > 0
  ON CONFLICT (chave) DO NOTHING
$$;

-- Um aviso por mudança real: a chave é locação + evento + transação, então a mesma gravação nunca gera dois avisos
-- (nem se o gatilho rodar duas vezes) e uma nova pendência/ajuste numa gravação posterior gera o aviso dela.
CREATE FUNCTION public.locacao_trg_avisos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _m jsonb := NEW.minuta; _o jsonb := OLD.minuta; _ev text; _txt text;
BEGIN
  BEGIN
    IF _m->>'estado' = 'com_corretor' AND (_o->>'estado' IS DISTINCT FROM 'com_corretor'
       OR _o->>'versao_enviada' IS DISTINCT FROM _m->>'versao_enviada') THEN
      _ev := 'minuta_enviada';
      _txt := 'Minuta' || coalesce(' v' || (_m->>'versao_enviada'), '') || ' pronta para você conferir e dar o de acordo.';
    ELSIF _m->>'estado' = 'pendencia' AND (_o->>'estado' IS DISTINCT FROM 'pendencia'
       OR _o->>'pendencia' IS DISTINCT FROM _m->>'pendencia') THEN
      _ev := 'pendencia'; _txt := 'Pendência para você resolver: ' || coalesce(_m->>'pendencia', '');
    ELSIF _m->>'estado' = 'ajuste' AND (_o->>'estado' IS DISTINCT FROM 'ajuste'
       OR _o->>'ajuste_motivo' IS DISTINCT FROM _m->>'ajuste_motivo') THEN
      _ev := 'ajuste'; _txt := 'Minuta em ajuste: ' || coalesce(_m->>'ajuste_motivo', '');
    ELSIF NEW.devolvida AND NEW.etapa IN ('pre_analise', 'documentacao') AND (NOT OLD.devolvida
       OR OLD.etapa IS DISTINCT FROM NEW.etapa OR OLD.motivo_devolucao IS DISTINCT FROM NEW.motivo_devolucao) THEN
      _ev := 'devolvida';
      _txt := CASE WHEN NEW.etapa = 'pre_analise' THEN 'Pré-análise devolvida pela gestora: '
        ELSE 'Documentação devolvida pela gestora: ' END || coalesce(NEW.motivo_devolucao, '');
    ELSE
      RETURN NULL;
    END IF;
    PERFORM public.locacao_aviso_novo(NEW, _ev,
      NEW.id::text || ':' || _ev || ':' || txid_current()::text || ':' || md5(_txt), _txt);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'locacao_trg_avisos: % %', SQLSTATE, SQLERRM; -- aviso nunca trava a ação de quem clicou
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER locacao_zz_avisos AFTER UPDATE ON public.locacoes
  FOR EACH ROW EXECUTE FUNCTION public.locacao_trg_avisos();

CREATE FUNCTION public.locacao_trg_avisos_andamento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes;
BEGIN
  IF NEW.aguardando IS DISTINCT FROM 'corretor' THEN RETURN NULL; END IF;
  BEGIN
    SELECT * INTO _l FROM public.locacoes WHERE id = NEW.locacao_id;
    PERFORM public.locacao_aviso_novo(_l, 'andamento', 'andamento:' || NEW.id::text, 'Andamento aguardando você: ' || NEW.texto);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'locacao_trg_avisos_andamento: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER locacao_zz_avisos AFTER INSERT ON public.locacao_andamentos
  FOR EACH ROW EXECUTE FUNCTION public.locacao_trg_avisos_andamento();

-- Quem está na tela pode pedir o envio dos avisos desta locação (o envio em si é do servidor).
CREATE FUNCTION public.locacao_avisos_pode(_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  RETURN _l.id IS NOT NULL AND public.locacao_pode_ver(_l);
END $$;
REVOKE ALL ON FUNCTION public.locacao_avisos_pode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_avisos_pode(uuid) TO authenticated;

-- Reserva no máximo 5 avisos (de até 24 h) desta locação; duas chamadas ao mesmo tempo nunca pegam o mesmo aviso.
CREATE FUNCTION public.locacao_avisos_reservar(_id uuid, _limite integer DEFAULT 5)
RETURNS TABLE (aviso_id uuid, evento text, texto text, codigo text, endereco text, telefone text, ativo boolean,
  quer_whatsapp boolean, locacao_id uuid, organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.locacao_avisos x SET status = 'expirado'
   WHERE x.locacao_id = _id AND x.status IN ('pendente', 'falhou') AND x.criado_em < now() - interval '24 hours';
  RETURN QUERY
  WITH alvo AS (
    SELECT a.id FROM public.locacao_avisos a
     WHERE a.locacao_id = _id AND a.criado_em >= now() - interval '24 hours'
       AND (a.status = 'pendente' OR (a.status = 'falhou' AND a.tentativas < 3))
     ORDER BY a.criado_em LIMIT least(greatest(coalesce(_limite, 5), 1), 5)
     FOR UPDATE SKIP LOCKED),
  upd AS (
    UPDATE public.locacao_avisos a SET status = 'enviando', tentativas = a.tentativas + 1, reservado_em = now()
      FROM alvo WHERE a.id = alvo.id RETURNING a.*)
  SELECT u.id, u.evento, u.texto, 'LOC-' || lpad(l.numero::text, 4, '0'),
         concat_ws(' — ', nullif(btrim(coalesce(l.endereco, '')), ''), nullif(btrim(coalesce(l.ficha->>'complemento', '')), '')),
         p.telefone, coalesce(p.ativo, false) AND l.corretor_id = u.destinatario_id,
         NOT coalesce((SELECT bool_and(r.notificar_whatsapp = false) FROM public.user_roles r
                         WHERE r.user_id = u.destinatario_id AND r.organization_id = u.organization_id), false),
         u.locacao_id, u.organization_id
    FROM upd u JOIN public.locacoes l ON l.id = u.locacao_id
    LEFT JOIN public.profiles p ON p.id = u.destinatario_id AND p.organization_id = u.organization_id
   ORDER BY u.criado_em;
END $$;

CREATE FUNCTION public.locacao_avisos_concluir(_aviso uuid, _status text, _erro text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _status IS NULL OR _status NOT IN ('enviado', 'falhou', 'incerto', 'ignorado') THEN
    RAISE EXCEPTION 'Situação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacao_avisos SET status = _status, erro = left(_erro, 300),
    enviado_em = CASE WHEN _status = 'enviado' THEN now() END
   WHERE id = _aviso AND status = 'enviando';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.locacao_avisos_reservar(uuid, integer), public.locacao_avisos_concluir(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_avisos_reservar(uuid, integer), public.locacao_avisos_concluir(uuid, text, text)
  TO service_role;

-- 11) Clientes da locação no cadastro de clientes (mesma tabela e mesma chave das vendas) -------------------------
CREATE TABLE public.locacao_clientes (
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  papel text NOT NULL CONSTRAINT locacao_clientes_papel_check
    CHECK (papel IN ('locatario', 'proprietario', 'proprietario_conjuge', 'fiador', 'fiador_conjuge')),
  cliente_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locacao_id, papel),
  CONSTRAINT locacao_clientes_cliente_fk FOREIGN KEY (cliente_id, organization_id)
    REFERENCES public.clientes(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX locacao_clientes_cliente_idx ON public.locacao_clientes (cliente_id);
ALTER TABLE public.locacao_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_clientes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_clientes TO service_role;

-- Casa pelo CPF/CNPJ dentro da imobiliária. Já existe: só completa o que estiver vazio (nunca troca o documento nem apaga
-- dado vindo de uma venda). Não existe: cria. Corrida (23505): reaproveita o cadastro criado pela outra chamada.
CREATE FUNCTION public.locacao_clientes_sincronizar(_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes; _v jsonb; _p record; _doc text; _cli public.clientes; _n integer := 0; _pj boolean;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id;
  IF _l.id IS NULL THEN RETURN 0; END IF;
  _v := public.locacao_contrato_valores(_l);
  FOR _p IN SELECT * FROM (VALUES
      ('locatario', coalesce(nullif(_v->>'loc_cpf', ''), _l.candidato->>'cpf'), _v->>'loc_nome', _v->>'loc_rg',
        _v->>'loc_profissao', _v->>'loc_email', _v->>'loc_telefone', coalesce(nullif(_v->>'loc_endereco', ''), _l.ficha->>'locatario_endereco')),
      ('proprietario', _v->>'prop_cpf', coalesce(nullif(_v->>'prop_nome', ''), _l.ficha#>>'{proprietario,nome}'), _v->>'prop_rg',
        _v->>'prop_profissao', coalesce(nullif(_v->>'prop_email', ''), _l.ficha#>>'{proprietario,email}'),
        coalesce(nullif(_v->>'prop_telefone', ''), _l.ficha#>>'{proprietario,telefone}'), _v->>'prop_endereco'),
      ('proprietario_conjuge', _v->>'prop_conj_cpf', _v->>'prop_conj_nome', _v->>'prop_conj_rg', _v->>'prop_conj_profissao',
        NULL, NULL, NULL),
      ('fiador', coalesce(nullif(_v->>'fia_cpf', ''), _l.ficha#>>'{fiador,cpf}'), coalesce(nullif(_v->>'fia_nome', ''), _l.ficha#>>'{fiador,nome}'),
        _v->>'fia_rg', _v->>'fia_profissao', _v->>'fia_email', _v->>'fia_telefone', _v->>'fia_endereco'),
      ('fiador_conjuge', _v->>'fia_conj_cpf', _v->>'fia_conj_nome', _v->>'fia_conj_rg', _v->>'fia_conj_profissao', NULL, NULL, NULL)
    ) t(papel, doc, nome, rg, profissao, email, telefone, endereco)
  LOOP
    CONTINUE WHEN _p.papel LIKE 'fiador%' AND _l.garantia <> 'fiador';
    _doc := regexp_replace(coalesce(_p.doc, ''), '[^0-9]', '', 'g');
    CONTINUE WHEN NOT ((length(_doc) = 11 AND public.locacao_cpf_ok(_doc)) OR length(_doc) = 14);
    _pj := length(_doc) = 14;
    SELECT * INTO _cli FROM public.clientes c WHERE c.organization_id = _l.organization_id AND c.cpf_cnpj_normalizado = _doc;
    IF _cli.id IS NULL THEN
      BEGIN
        INSERT INTO public.clientes (organization_id, tipo_pessoa, nome, razao_social, cnpj, cpf_cnpj, rg, profissao, email, telefone,
          endereco, created_by)
        VALUES (_l.organization_id, CASE WHEN _pj THEN 'juridica' ELSE 'fisica' END,
          CASE WHEN _pj THEN NULL ELSE nullif(btrim(coalesce(_p.nome, '')), '') END,
          CASE WHEN _pj THEN nullif(btrim(coalesce(_p.nome, '')), '') END, CASE WHEN _pj THEN btrim(_p.doc) END,
          btrim(_p.doc), nullif(btrim(coalesce(_p.rg, '')), ''), nullif(btrim(coalesce(_p.profissao, '')), ''),
          nullif(btrim(coalesce(_p.email, '')), ''), nullif(btrim(coalesce(_p.telefone, '')), ''),
          nullif(btrim(coalesce(_p.endereco, '')), ''), auth.uid())
        RETURNING * INTO _cli;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO _cli FROM public.clientes c WHERE c.organization_id = _l.organization_id AND c.cpf_cnpj_normalizado = _doc;
      END;
    END IF;
    CONTINUE WHEN _cli.id IS NULL;
    UPDATE public.clientes c SET
      nome = CASE WHEN _pj THEN c.nome ELSE coalesce(nullif(c.nome, ''), nullif(btrim(coalesce(_p.nome, '')), '')) END,
      razao_social = CASE WHEN _pj THEN coalesce(nullif(c.razao_social, ''), nullif(btrim(coalesce(_p.nome, '')), '')) ELSE c.razao_social END,
      rg = coalesce(nullif(c.rg, ''), nullif(btrim(coalesce(_p.rg, '')), '')),
      profissao = coalesce(nullif(c.profissao, ''), nullif(btrim(coalesce(_p.profissao, '')), '')),
      email = coalesce(nullif(c.email, ''), nullif(btrim(coalesce(_p.email, '')), '')),
      telefone = coalesce(nullif(c.telefone, ''), nullif(btrim(coalesce(_p.telefone, '')), '')),
      endereco = coalesce(nullif(c.endereco, ''), nullif(btrim(coalesce(_p.endereco, '')), '')),
      updated_by = auth.uid()
     WHERE c.id = _cli.id AND (
       (NOT _pj AND nullif(c.nome, '') IS NULL AND nullif(btrim(coalesce(_p.nome, '')), '') IS NOT NULL)
       OR (_pj AND nullif(c.razao_social, '') IS NULL AND nullif(btrim(coalesce(_p.nome, '')), '') IS NOT NULL)
       OR (nullif(c.rg, '') IS NULL AND nullif(btrim(coalesce(_p.rg, '')), '') IS NOT NULL)
       OR (nullif(c.profissao, '') IS NULL AND nullif(btrim(coalesce(_p.profissao, '')), '') IS NOT NULL)
       OR (nullif(c.email, '') IS NULL AND nullif(btrim(coalesce(_p.email, '')), '') IS NOT NULL)
       OR (nullif(c.telefone, '') IS NULL AND nullif(btrim(coalesce(_p.telefone, '')), '') IS NOT NULL)
       OR (nullif(c.endereco, '') IS NULL AND nullif(btrim(coalesce(_p.endereco, '')), '') IS NOT NULL));
    INSERT INTO public.locacao_clientes AS lc (locacao_id, papel, cliente_id, organization_id)
    VALUES (_l.id, _p.papel, _cli.id, _l.organization_id)
    ON CONFLICT (locacao_id, papel) DO UPDATE SET cliente_id = EXCLUDED.cliente_id, atualizado_em = now()
     WHERE lc.cliente_id IS DISTINCT FROM EXCLUDED.cliente_id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

CREATE FUNCTION public.locacao_trg_clientes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid;
BEGIN
  IF TG_TABLE_NAME = 'locacoes' THEN _id := NEW.id; ELSE _id := NEW.locacao_id; END IF;
  BEGIN
    PERFORM public.locacao_clientes_sincronizar(_id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'locacao_clientes_sincronizar: % %', SQLSTATE, SQLERRM; -- cadastro de cliente nunca trava a locação
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER locacao_zz_clientes AFTER INSERT OR UPDATE OF candidato, ficha, garantia ON public.locacoes
  FOR EACH ROW EXECUTE FUNCTION public.locacao_trg_clientes();
CREATE TRIGGER locacao_zz_clientes AFTER INSERT OR UPDATE OF valores ON public.locacao_contrato_dados
  FOR EACH ROW EXECUTE FUNCTION public.locacao_trg_clientes();

REVOKE ALL ON FUNCTION public.locacao_imovel_tipo_rotulo(text), public.locacao_equipe_do_corretor(uuid, uuid),
  public.locacao_trg_abertura(), public.locacao_aviso_novo(public.locacoes, text, text, text), public.locacao_trg_avisos(),
  public.locacao_trg_avisos_andamento(), public.locacao_clientes_sincronizar(uuid), public.locacao_trg_clientes()
  FROM PUBLIC, anon, authenticated;

COMMIT;
