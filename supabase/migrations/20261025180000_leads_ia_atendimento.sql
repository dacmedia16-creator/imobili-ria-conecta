-- Leads — IA de atendimento (papel da Lais). Card t_8046ecb0; "vamos criar agora", Denis 25/10/2026, tópico 6238.
-- Base: P1 20261025120000, P2/P3 20261025150000, contato 20261025160000. Não depende da entrada do
-- Grupo ZAP (t_478b211e): a IA dispara por gatilho AFTER INSERT em leads, seja qual for a origem.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261025180000_leads_ia_atendimento.rollback.sql
--
-- Regras:
--  1) IA só age se o módulo "leads" E lead_config.ia_ativa estiverem ligados (ia_ativa nasce DESLIGADA).
--  2) Lead novo -> 1 conversa (UNIQUE lead_id) + 1ª mensagem pronta (apresenta-se pela imobiliária,
--     cita o imóvel cadastrado quando houver, confirma o interesse e explica o SAIR).
--  3) Qualificação (finalidade, prazo, pagamento, faixa, região, visita/contato) roda no servidor do ADM
--     (src/lib/leads-ia.ts) com textos FIXOS: a IA não inventa preço, condição nem disponibilidade.
--  4) Fim da qualificação, pedido de pessoa, assunto sensível ou "sem interesse" -> a IA para e o
--     responsável recebe um resumo no sino (sem lead responsável ou assunto sensível: gestores/admin).
--  5) Mensagem da conversa conta como interação (regras de 7/30 dias) quando o lead já foi aceito.
--  6) Opt-out (SAIR, PARAR, "não quero receber"...) é decidido AQUI no banco: grava o contato na lista
--     da imobiliária, para a IA e impede nova conversa para o mesmo telefone/e-mail.
--  7) Histórico por imobiliária com RLS: gestor/admin sempre; responsável (e TL) só depois do aceite.
--  8) Canal: 'teste' (padrão) = nada sai do ADM, mensagens ficam "não enviadas". 'ziontalk' só pode ser
--     ligado pelo servidor (service_role), depois do "sim" de Denis; nenhum envio nesta migration.
BEGIN;

-- 1) Configuração ---------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_ativa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_nome text NOT NULL DEFAULT 'Assistente virtual'
    CONSTRAINT lead_config_ia_nome_check CHECK (char_length(btrim(ia_nome)) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS ia_boas_vindas text
    CONSTRAINT lead_config_ia_boas_vindas_check CHECK (char_length(ia_boas_vindas) <= 400),
  ADD COLUMN IF NOT EXISTS ia_canal text NOT NULL DEFAULT 'teste'
    CONSTRAINT lead_config_ia_canal_check CHECK (ia_canal IN ('teste', 'ziontalk')),
  -- Envio real FUTURO por QR Code (chip comum): travas anti-bloqueio. Nada é enviado por esta migration;
  -- o envio só existe com LEADS_IA_ENVIO_REAL=on + canal 'ziontalk' (outro "sim" de Denis).
  ADD COLUMN IF NOT EXISTS ia_envio_limite_dia integer NOT NULL DEFAULT 10
    CONSTRAINT lead_config_ia_envio_limite_dia_check CHECK (ia_envio_limite_dia BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS ia_envio_intervalo_min_s integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS ia_envio_intervalo_max_s integer NOT NULL DEFAULT 180,
  -- Envio real SÓ para estes contatos (telefone sem o 55, como em lead_ia_contatos). Vazio = ninguém.
  -- Não existe chave geral: mesmo com o canal 'ziontalk', contato fora da lista fica em modo teste.
  ADD COLUMN IF NOT EXISTS ia_envio_allowlist text[] NOT NULL DEFAULT '{}'
    CONSTRAINT lead_config_ia_envio_allowlist_check CHECK (cardinality(ia_envio_allowlist) <= 20);
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_envio_intervalo_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_envio_intervalo_check
  CHECK (ia_envio_intervalo_min_s BETWEEN 30 AND 900 AND ia_envio_intervalo_max_s BETWEEN ia_envio_intervalo_min_s AND 1800);
-- Nenhum link na 1ª mensagem: o texto de boas-vindas não aceita endereço (endereço web, www, dominio.com.br...).
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_ia_boas_vindas_sem_link;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_ia_boas_vindas_sem_link
  CHECK (ia_boas_vindas IS NULL OR ia_boas_vindas !~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/))');

-- 2) Linha do tempo: tipo 'ia' -----------------------------------------------------------------------
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo',
                  'aceite', 'devolvido_banco', 'redistribuido', 'ligacao', 'ia'));

-- 3) Tabelas -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lead_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('teste', 'ziontalk')),
  estado text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa', 'passada', 'optout', 'parada')),
  passo text NOT NULL DEFAULT 'interesse'
    CHECK (passo IN ('interesse', 'finalidade', 'prazo', 'pagamento', 'faixa', 'regiao', 'proximo_passo', 'fim')),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object' AND pg_column_size(dados) <= 8000),
  -- versao = mensagens do cliente recebidas; respondida_versao = última que a IA respondeu (idempotência).
  versao integer NOT NULL DEFAULT 0 CHECK (versao >= 0),
  respondida_versao integer NOT NULL DEFAULT 0 CHECK (respondida_versao >= 0),
  motivo_fim text CHECK (motivo_fim IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse', 'optout',
                                        'parada_manual', 'limite')),
  resumo text CHECK (char_length(resumo) <= 1000),
  encerrada_em timestamptz,
  primeira_enviada_em timestamptz, -- 1ª mensagem que saiu de verdade (limite por dia)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_conversas_um_por_lead UNIQUE (lead_id),
  UNIQUE (id, organization_id),
  CONSTRAINT lead_conversas_lead_org_fk FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.leads(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lead_conversas_org_idx ON public.lead_conversas (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  autor text NOT NULL CHECK (autor IN ('ia', 'cliente', 'sistema')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 2000),
  -- nao_enviada = modo teste (nada saiu do ADM); pendente/enviada/falhou = canal real (fase seguinte);
  -- simulada = o gestor respondeu como cliente na tela de teste; recebida = veio do WhatsApp real.
  status text NOT NULL CHECK (status IN ('nao_enviada', 'pendente', 'enviando', 'enviada', 'falhou', 'simulada', 'recebida')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_mensagens_conversa_org_fk FOREIGN KEY (conversa_id, organization_id)
    REFERENCES public.lead_conversas(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lead_mensagens_conversa_idx ON public.lead_mensagens (conversa_id, created_at);
CREATE INDEX IF NOT EXISTS lead_mensagens_org_idx ON public.lead_mensagens (organization_id, created_at);

-- Quem pediu para não receber mensagens (telefone ou e-mail), por imobiliária. Só o servidor lê.
CREATE TABLE IF NOT EXISTS public.lead_ia_optouts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contato text NOT NULL CHECK (char_length(contato) BETWEEN 3 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, contato)
);

-- 4) Acesso ------------------------------------------------------------------------------------------
ALTER TABLE public.lead_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_ia_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_conversas, public.lead_mensagens, public.lead_ia_optouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lead_conversas, public.lead_mensagens TO authenticated;
GRANT ALL ON public.lead_conversas, public.lead_mensagens, public.lead_ia_optouts TO service_role;

-- Mesma regra do contato (20261025160000): gestor/admin sempre; responsável/TL só depois do aceite.
CREATE OR REPLACE FUNCTION public.lead_ia_pode_ver(_lead uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.leads_gestor() OR EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.id = _lead AND l.organization_id = public.current_org_id()
       AND l.aceito_em IS NOT NULL AND l.no_banco_desde IS NULL
       AND l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis())))
$$;
REVOKE ALL ON FUNCTION public.lead_ia_pode_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_ia_pode_ver(uuid) TO authenticated, service_role;

CREATE POLICY org_isolation ON public.lead_conversas AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.lead_mensagens AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_conversas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_mensagens AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY lead_conversas_read ON public.lead_conversas FOR SELECT TO authenticated
  USING (public.lead_ia_pode_ver(lead_id));
-- Mensagens seguem a conversa (a subconsulta passa pela RLS de lead_conversas).
CREATE POLICY lead_mensagens_read ON public.lead_mensagens FOR SELECT TO authenticated
  USING (conversa_id IN (SELECT c.id FROM public.lead_conversas c));

-- 5) Peças internas (sem acesso do app) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_norm(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'))
$$;

-- Pedido para não receber mensagens. A mesma lista está em src/lib/leads-ia.ts (ehOptOut) só para a tela.
CREATE OR REPLACE FUNCTION public.lead_ia_e_optout(_t text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT public.lead_ia_norm(_t) ~ '^\s*(quero |pode )?(sair|parar|pare|stop|cancelar|descadastrar|remover)[\s,.!]*(por favor|pf|pfv|obrigad[oa])?[\s.!]*$'
      OR public.lead_ia_norm(_t) ~ '(nao (quero|desejo) (mais )?(receber|mensage)|nao me (mande|envie|chame|procure)|(para|parar|pare) de (me )?(mandar|enviar)|remov(a|e|er) (o )?meu (numero|contato|telefone)|(me )?(tira|tire|remove|remova) (da|dessa|desta|de sua|da sua) lista|descadastr)'
$$;

-- Chave de opt-out: telefone só com dígitos e sem o 55 (+5515..., 5515... e 15... viram a mesma chave);
-- e-mail em minúsculas.
CREATE OR REPLACE FUNCTION public.lead_ia_contatos(_tel text, _email text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN d ~ '^55[0-9]{10,11}$' THEN substr(d, 3) WHEN char_length(d) >= 8 THEN d END,
    nullif(lower(btrim(coalesce(_email, ''))), '')], NULL)
  FROM (SELECT regexp_replace(coalesce(_tel, ''), '[^0-9]', '', 'g') AS d) x
$$;

-- Tira telefone e e-mail de qualquer texto que vá para o sino ou para a linha do tempo
-- (o corretor pode ler esses lugares antes do aceite).
CREATE OR REPLACE FUNCTION public.lead_ia_mascarar(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT regexp_replace(regexp_replace(coalesce(_t, ''), '[^@\s]+@[^@\s]+', '[e-mail]', 'g'),
                        '\+?[0-9][0-9\s().-]{6,}[0-9]', '[número]', 'g')
$$;

-- Descrição do imóvel SÓ com o que está cadastrado na captação (tipo e bairro). Sem preço.
CREATE OR REPLACE FUNCTION public.lead_ia_imovel(_capture uuid, _org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE
    WHEN t IS NOT NULL AND b IS NOT NULL THEN lower(t) || ' no bairro ' || b
    WHEN t IS NOT NULL THEN lower(t)
    WHEN b IS NOT NULL THEN 'no bairro ' || b END
  FROM (SELECT left(nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''), 40) AS t,
               left(nullif(btrim(c.form_data->'imovel'->>'bairro'), ''), 60) AS b
          FROM public.exclusive_captures c WHERE c.id = _capture AND c.organization_id = _org) x
$$;

CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l public.leads, _c public.lead_config, _org_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _imovel text; _base text;
BEGIN
  IF _l.capture_id IS NOT NULL THEN _imovel := public.lead_ia_imovel(_l.capture_id, _l.organization_id); END IF;
  _base := regexp_replace(coalesce(nullif(btrim(_c.ia_boas_vindas), ''), 'Recebi seu contato'), '[.!?\s]+$', '');
  RETURN left(format('Olá, %s! Aqui é %s, da %s. %s%s. Você ainda tem interesse? (Se não quiser receber mensagens, responda SAIR.)',
    split_part(btrim(_l.nome), ' ', 1), btrim(_c.ia_nome), coalesce(_org_nome, 'imobiliária'), _base,
    coalesce(' sobre o imóvel ' || _imovel, '')), 2000);
END $$;

-- Status de uma mensagem que SAI do ADM: só fica "pendente" (fila do envio real) se a conversa E a
-- imobiliária estiverem no canal ziontalk, o lead tiver telefone e não for simulado. Senão, "não enviada".
CREATE OR REPLACE FUNCTION public.lead_ia_status_saida(_conversa uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT 'pendente' FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
     WHERE cv.id = _conversa AND cv.canal = 'ziontalk' AND c.ia_canal = 'ziontalk'
       AND l.telefone IS NOT NULL AND NOT l.simulado
       AND public.lead_ia_contatos(l.telefone, NULL) && c.ia_envio_allowlist), 'nao_enviada')
$$;

-- Conversa conta como interação (7/30 dias) quando o lead já foi aceito e está com alguém.
CREATE OR REPLACE FUNCTION public.lead_ia_tocar(_lead uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  UPDATE public.leads SET updated_at = now(),
         ultima_interacao_em = CASE WHEN aceito_em IS NOT NULL AND no_banco_desde IS NULL
                                     AND etapa NOT IN ('ganho', 'perdido') THEN now() ELSE ultima_interacao_em END
   WHERE id = _lead
$$;

-- Encerra a participação da IA e avisa no sino (resumo sem telefone/e-mail).
CREATE OR REPLACE FUNCTION public.lead_ia_passar(_conversa uuid, _motivo text, _resumo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _g record; _titulo text; _msg text;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _cv.estado <> 'ativa' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  UPDATE public.lead_conversas
     SET estado = CASE _motivo WHEN 'optout' THEN 'optout' WHEN 'parada_manual' THEN 'parada' ELSE 'passada' END,
         motivo_fim = _motivo, resumo = left(public.lead_ia_mascarar(_resumo), 1000), passo = 'fim', encerrada_em = now(), updated_at = now()
   WHERE id = _cv.id;
  -- O resumo completo fica só na conversa (RLS: gestor, ou responsável depois do aceite). A linha do tempo
  -- e o sino podem ser lidos antes do aceite: lá vai só o motivo, e o resumo apenas se já aceito.
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_cv.organization_id, _cv.lead_id, 'ia', _motivo, auth.uid());
  _titulo := CASE _motivo
    WHEN 'qualificado' THEN 'IA qualificou um lead seu'
    WHEN 'pediu_pessoa' THEN 'Cliente pediu para falar com o corretor'
    WHEN 'sensivel' THEN 'Atenção: assunto sensível em um lead'
    WHEN 'sem_interesse' THEN 'Lead disse que não tem interesse'
    WHEN 'optout' THEN 'Lead pediu para não receber mensagens'
    WHEN 'limite' THEN 'Conversa da IA passou para você'
    ELSE 'IA parada neste lead' END;
  _msg := 'Lead "' || _l.nome || '": ' || left(public.lead_ia_mascarar(_resumo), 300) || ' Veja a conversa em Meus leads.';
  IF _l.responsavel_id IS NOT NULL THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _cv.organization_id, _titulo,
      CASE WHEN _l.aceito_em IS NOT NULL THEN _msg
           ELSE 'Lead "' || _l.nome || '": aceite o lead em Meus leads para ver o resumo e a conversa.' END);
  END IF;
  -- Sem responsável, ou assunto sensível: gestores e administradores da imobiliária também recebem.
  IF _l.responsavel_id IS NULL OR _motivo = 'sensivel' THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id AND r.role::text IN ('admin', 'gestor')
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $$;

-- Grava a mensagem do cliente (tela de teste agora; webhook ZionTalk na fase do envio real).
-- Opt-out é decidido aqui, antes de qualquer IA. Devolve o contexto para a IA responder.
CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid;
BEGIN
  IF char_length(_t) = 0 THEN RAISE EXCEPTION 'Mensagem vazia' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
  VALUES (_cv.organization_id, _cv.id, 'cliente', _t, _status);
  UPDATE public.lead_conversas SET versao = versao + 1, updated_at = now() WHERE id = _cv.id
  RETURNING * INTO _cv;
  PERFORM public.lead_ia_tocar(_l.id);

  IF public.lead_ia_e_optout(_t) THEN
    INSERT INTO public.lead_ia_optouts (organization_id, contato)
    SELECT _cv.organization_id, x FROM unnest(public.lead_ia_contatos(_l.telefone, _l.email)) x
    ON CONFLICT DO NOTHING;
    -- Outros leads abertos do mesmo contato nesta imobiliária: a IA para em todos.
    FOR _outra IN SELECT cv.id FROM public.lead_conversas cv JOIN public.leads l2 ON l2.id = cv.lead_id
                   WHERE cv.organization_id = _cv.organization_id AND cv.id <> _cv.id AND cv.estado = 'ativa'
                     AND public.lead_ia_contatos(l2.telefone, l2.email) && public.lead_ia_contatos(_l.telefone, _l.email) LOOP
      PERFORM public.lead_ia_passar(_outra, 'optout', 'Este contato pediu para não receber mais mensagens (SAIR) em outro lead.');
    END LOOP;
    IF _cv.estado = 'ativa' THEN
      INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
      VALUES (_cv.organization_id, _cv.id, 'sistema',
              'Pronto, você não vai mais receber mensagens nossas por aqui. Obrigado!',
              public.lead_ia_status_saida(_cv.id));
      PERFORM public.lead_ia_passar(_cv.id, 'optout', 'Cliente pediu para não receber mais mensagens (SAIR). Não envie mensagens automáticas.');
    END IF;
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'optout');
  END IF;

  IF _cv.estado <> 'ativa' THEN
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', _cv.estado);
  END IF;
  -- Trava de segurança: conversa longa demais vai para o corretor.
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'cliente';
  IF _n > 30 THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'passada');
  END IF;
  RETURN jsonb_build_object(
    'conversa_id', _cv.id, 'estado', _cv.estado, 'versao', _cv.versao, 'passo', _cv.passo, 'dados', _cv.dados,
    'ia_nome', coalesce(_c.ia_nome, 'Assistente virtual'),
    'lead_nome', split_part(btrim(_l.nome), ' ', 1),
    'imovel', CASE WHEN _l.capture_id IS NOT NULL THEN public.lead_ia_imovel(_l.capture_id, _l.organization_id) END);
END $$;

-- Gatilho: QUALQUER lead novo (manual, formulário, simulador, Grupo ZAP...). Nunca impede a entrada do lead.
CREATE OR REPLACE FUNCTION public.lead_ia_iniciar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _org text; _conv uuid;
BEGIN
  BEGIN
    IF NEW.etapa IN ('ganho', 'perdido') THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organization_modules
                    WHERE organization_id = NEW.organization_id AND module = 'leads' AND enabled) THEN RETURN NULL; END IF;
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = NEW.organization_id;
    IF _c.organization_id IS NULL OR NOT _c.ia_ativa THEN RETURN NULL; END IF;
    SELECT nome INTO _org FROM public.organizations WHERE id = NEW.organization_id AND status = 'ativa';
    IF _org IS NULL THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = NEW.organization_id
                AND contato = ANY (public.lead_ia_contatos(NEW.telefone, NEW.email))) THEN
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (NEW.organization_id, NEW.id, 'ia', 'optout', 'IA não iniciada: este contato pediu para não receber mensagens.');
      RETURN NULL;
    END IF;
    INSERT INTO public.lead_conversas (organization_id, lead_id, canal)
    VALUES (NEW.organization_id, NEW.id,
            CASE WHEN NOT NEW.simulado AND _c.ia_canal = 'ziontalk'
                      AND public.lead_ia_contatos(NEW.telefone, NULL) && _c.ia_envio_allowlist THEN 'ziontalk'
                 ELSE 'teste' END)
    ON CONFLICT (lead_id) DO NOTHING RETURNING id INTO _conv;
    IF _conv IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (NEW.organization_id, _conv, 'ia', public.lead_ia_primeira_msg(NEW, _c, _org),
            public.lead_ia_status_saida(_conv));
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (NEW.organization_id, NEW.id, 'ia', 'iniciada',
            CASE WHEN (SELECT canal FROM public.lead_conversas WHERE id = _conv) = 'teste' THEN 'IA preparou a 1ª mensagem (modo teste: não enviada).'
                 ELSE 'IA preparou a 1ª mensagem.' END);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_ia_iniciar: lead % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_lead_ia_iniciar ON public.leads;
CREATE TRIGGER zz_lead_ia_iniciar AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_ia_iniciar();

REVOKE ALL ON FUNCTION public.lead_ia_norm(text), public.lead_ia_e_optout(text), public.lead_ia_imovel(uuid, uuid),
  public.lead_ia_contatos(text, text), public.lead_ia_mascarar(text),
  public.lead_ia_primeira_msg(public.leads, public.lead_config, text), public.lead_ia_status_saida(uuid),
  public.lead_ia_tocar(uuid), public.lead_ia_passar(uuid, text, text), public.lead_ia_registrar_cliente(uuid, text, text),
  public.lead_ia_iniciar() FROM PUBLIC, anon, authenticated;

-- 6) RPCs ------------------------------------------------------------------------------------------
-- Tela de teste: o gestor responde COMO SE FOSSE o cliente. Só no canal 'teste'.
CREATE OR REPLACE FUNCTION public.lead_ia_cliente_simular(_lead uuid, _texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _l public.leads; _cv public.lead_conversas;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador usa o simulador' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF char_length(btrim(coalesce(_texto, ''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Mensagem vazia ou longa demais' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _l.id AND organization_id = _org;
  IF _cv.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _cv.canal <> 'teste' THEN
    RAISE EXCEPTION 'Simulador so funciona no modo teste' USING ERRCODE = '42501';
  END IF;
  RETURN public.lead_ia_registrar_cliente(_cv.id, _texto, 'simulada');
END $$;

-- Gestor ou responsável (já aceito) para a IA e assume a conversa.
CREATE OR REPLACE FUNCTION public.lead_ia_parar(_lead uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _l public.leads; _cv public.lead_conversas;
BEGIN
  _l := public.lead_pega(_lead, _org);
  IF NOT public.leads_gestor() AND NOT (_l.responsavel_id = auth.uid() AND _l.aceito_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Aceite o lead antes de atender' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _l.id AND organization_id = _org;
  IF _cv.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _cv.estado = 'ativa' THEN
    PERFORM public.lead_ia_passar(_cv.id, 'parada_manual', 'IA parada manualmente; o atendimento segue com o corretor.');
  END IF;
  RETURN (SELECT estado FROM public.lead_conversas WHERE id = _cv.id);
END $$;

-- Configuração da IA (só administrador, como os prazos). Canal não muda por aqui.
CREATE OR REPLACE FUNCTION public.lead_ia_config_salvar(_ativa boolean, _nome text, _boas_vindas text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _ativa IS NULL OR char_length(btrim(coalesce(_nome, ''))) NOT BETWEEN 1 AND 40
     OR char_length(coalesce(_boas_vindas, '')) > 400 THEN
    RAISE EXCEPTION 'Configuracao da IA invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET ia_ativa = _ativa, ia_nome = btrim(_nome),
         ia_boas_vindas = nullif(btrim(coalesce(_boas_vindas, '')), ''), updated_at = now()
   WHERE organization_id = _org;
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_cliente_simular(uuid, text), public.lead_ia_parar(uuid),
  public.lead_ia_config_salvar(boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_ia_cliente_simular(uuid, text), public.lead_ia_parar(uuid),
  public.lead_ia_config_salvar(boolean, text, text) TO authenticated, service_role;

-- 7) Só o servidor do ADM (service_role) ------------------------------------------------------------
-- Grava a resposta da IA. Idempotente: só responde a versão atual e uma vez (dois cliques = 1 resposta).
CREATE OR REPLACE FUNCTION public.lead_ia_aplicar(_conversa uuid, _versao integer, _passo text, _dados jsonb,
  _resposta text, _fim text, _resumo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _ok boolean;
BEGIN
  -- Mesma ordem de trava do simulador (lead, depois conversa): evita deadlock em clique duplo.
  SELECT * INTO _l FROM public.leads WHERE id = (SELECT lead_id FROM public.lead_conversas WHERE id = _conversa) FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _l.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _cv.estado <> 'ativa' OR _versao IS DISTINCT FROM _cv.versao OR _cv.respondida_versao >= _versao THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'desatualizado');
  END IF;
  SELECT (m.enabled AND c.ia_ativa AND o.status = 'ativa') INTO _ok FROM public.lead_config c
    JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads'
    JOIN public.organizations o ON o.id = c.organization_id
   WHERE c.organization_id = _cv.organization_id;
  IF NOT coalesce(_ok, false) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'ia_desligada'); END IF;
  IF _l.etapa IN ('ganho', 'perdido') THEN
    PERFORM public.lead_ia_passar(_cv.id, 'parada_manual', 'Lead encerrado: a IA parou.');
    RETURN jsonb_build_object('ok', false, 'motivo', 'lead_encerrado');
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _cv.organization_id
              AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    PERFORM public.lead_ia_passar(_cv.id, 'optout', 'Este contato pediu para não receber mensagens (SAIR).');
    RETURN jsonb_build_object('ok', false, 'motivo', 'optout');
  END IF;
  IF _passo IS NULL OR _passo NOT IN ('interesse', 'finalidade', 'prazo', 'pagamento', 'faixa', 'regiao', 'proximo_passo', 'fim')
     OR _dados IS NULL OR jsonb_typeof(_dados) <> 'object'
     OR (_fim IS NOT NULL AND _fim NOT IN ('qualificado', 'pediu_pessoa', 'sensivel', 'sem_interesse'))
     OR char_length(coalesce(_resposta, '')) > 2000 THEN
    RAISE EXCEPTION 'Resposta da IA invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_resposta, '')), '') IS NOT NULL THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'ia', btrim(_resposta), public.lead_ia_status_saida(_cv.id));
  END IF;
  UPDATE public.lead_conversas SET passo = _passo, dados = _dados, respondida_versao = _versao, updated_at = now()
   WHERE id = _cv.id;
  PERFORM public.lead_ia_tocar(_cv.lead_id);
  IF _fim IS NOT NULL THEN PERFORM public.lead_ia_passar(_cv.id, _fim, coalesce(_resumo, 'Conversa encerrada pela IA.')); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Liga o canal real de uma imobiliária. Só depois do "sim" de Denis (número + custo), pelo servidor.
CREATE OR REPLACE FUNCTION public.lead_ia_canal_definir(_org uuid, _canal text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _canal IS NULL OR _canal NOT IN ('teste', 'ziontalk') THEN RAISE EXCEPTION 'Canal invalido' USING ERRCODE = '22023'; END IF;
  UPDATE public.lead_config SET ia_canal = _canal, updated_at = now() WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
  IF _canal = 'teste' THEN
    -- Desligar o envio real vale também para as conversas abertas e para a fila ainda não enviada.
    UPDATE public.lead_conversas SET canal = 'teste', updated_at = now() WHERE organization_id = _org AND canal <> 'teste';
    UPDATE public.lead_mensagens SET status = 'nao_enviada' WHERE organization_id = _org AND status = 'pendente';
  END IF;
  RETURN _canal;
END $$;

-- Travas do envio real futuro (QR Code): limite de 1ª mensagem por dia e intervalo aleatório entre envios.
-- Só a plataforma (service_role) ajusta; não liga nada.
CREATE OR REPLACE FUNCTION public.lead_ia_envio_definir(_org uuid, _limite_dia integer, _min_s integer, _max_s integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _limite_dia IS NULL OR _limite_dia NOT BETWEEN 1 AND 200 OR _min_s IS NULL OR _min_s NOT BETWEEN 30 AND 900
     OR _max_s IS NULL OR _max_s < _min_s OR _max_s > 1800 THEN
    RAISE EXCEPTION 'Travas de envio invalidas' USING ERRCODE = '22023';
  END IF;
  UPDATE public.lead_config SET ia_envio_limite_dia = _limite_dia, ia_envio_intervalo_min_s = _min_s,
         ia_envio_intervalo_max_s = _max_s, updated_at = now() WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text),
  public.lead_ia_canal_definir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text),
  public.lead_ia_canal_definir(uuid, text) TO service_role;
-- Lista de contatos liberados para o envio real (teste autorizado por Denis). Só a plataforma.
CREATE OR REPLACE FUNCTION public.lead_ia_allowlist_definir(_org uuid, _telefones text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _lista text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT k), '{}') INTO _lista
    FROM unnest(coalesce(_telefones, '{}')) t, unnest(public.lead_ia_contatos(t, NULL)) k;
  IF cardinality(_lista) > 20 THEN RAISE EXCEPTION 'Lista grande demais' USING ERRCODE = '22023'; END IF;
  UPDATE public.lead_config SET ia_envio_allowlist = _lista, updated_at = now() WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
  RETURN cardinality(_lista);
END $$;

-- Reserva a próxima mensagem pendente de UM lead para o envio real (1 por chamada).
-- Confere tudo de novo: módulo, IA ligada, canal real na imobiliária E na conversa, contato na lista,
-- não está em opt-out e, se for a 1ª mensagem, o limite do dia. Marca 'enviando' (dois cliques = 1 envio).
CREATE OR REPLACE FUNCTION public.lead_ia_envio_reservar(_lead uuid)
RETURNS TABLE (msg_id uuid, telefone text, texto text, primeira boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _m public.lead_mensagens; _hoje integer;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead FOR UPDATE;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  IF _l.id IS NULL OR _cv.id IS NULL OR _c.organization_id IS NULL THEN RETURN; END IF;
  IF NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _cv.canal <> 'ziontalk' OR _l.simulado
     OR NOT (public.lead_ia_contatos(_l.telefone, NULL) && _c.ia_envio_allowlist)
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                     AND module = 'leads' AND enabled)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _l.organization_id
                 AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))
                 AND _cv.estado <> 'optout') THEN
    RETURN;
  END IF;
  SELECT * INTO _m FROM public.lead_mensagens WHERE conversa_id = _cv.id AND status = 'pendente'
   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _m.id IS NULL THEN RETURN; END IF;
  IF _cv.primeira_enviada_em IS NULL THEN
    SELECT count(*) INTO _hoje FROM public.lead_conversas
     WHERE organization_id = _cv.organization_id AND primeira_enviada_em IS NOT NULL
       AND (primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    IF _hoje >= _c.ia_envio_limite_dia THEN RETURN; END IF;
  END IF;
  UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
  msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := _cv.primeira_enviada_em IS NULL;
  RETURN NEXT;
END $$;

-- Resultado do envio real de uma mensagem reservada.
CREATE OR REPLACE FUNCTION public.lead_ia_envio_resultado(_msg uuid, _ok boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv uuid;
BEGIN
  UPDATE public.lead_mensagens SET status = CASE WHEN _ok THEN 'enviada' ELSE 'falhou' END
   WHERE id = _msg AND status = 'enviando' RETURNING conversa_id INTO _cv;
  IF _cv IS NOT NULL AND _ok THEN
    UPDATE public.lead_conversas SET primeira_enviada_em = coalesce(primeira_enviada_em, now()), updated_at = now()
     WHERE id = _cv;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_allowlist_definir(uuid, text[]), public.lead_ia_envio_reservar(uuid),
  public.lead_ia_envio_resultado(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_allowlist_definir(uuid, text[]), public.lead_ia_envio_reservar(uuid),
  public.lead_ia_envio_resultado(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.lead_ia_envio_definir(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_envio_definir(uuid, integer, integer, integer) TO service_role;

COMMIT;
