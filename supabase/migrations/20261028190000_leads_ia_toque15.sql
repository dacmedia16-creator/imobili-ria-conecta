-- Lembrete rápido de 15 min da Nicole (t_b3f753a5, "sim" + "15 min" de Denis em 28/10).
-- Quando o cliente JÁ respondeu ao menos 1 vez, a última mensagem da conversa é da Nicole (enviada de verdade) e
-- passaram lead_config.ia_toque15_min minutos (padrão 15) sem resposta, a Nicole manda UM toque curto retomando o
-- ponto em que a conversa parou. Só 1 vez por conversa (lead_conversas.toque15_em).
--  * Chave própria por imobiliária, DESLIGADA por padrão (lead_config.ia_toque15), separada do ia_reengajar.
--  * Horário comercial (seg-sáb, 9h-19h de Brasília), como o reengajamento. Fora do horário espera a abertura;
--    se nesse meio-tempo já chegou a janela do lembrete de ~24 h (ia_reengajar_h1), não manda (fica só o de 24 h).
--    Os dois nunca saem juntos: depois do toque, o lembrete de ~24 h conta a partir dele (regra já existente).
--  * Para: cliente respondeu, conversa passada/recusada/SAIR/parada, lead ganho/perdido, corretor aceitou o lead,
--    a equipe escreveu pelo número ou alguém da equipe registrou algo no lead.
--  * Mesmas travas do reengajamento: lista de liberados, opt-out, limite diário (1ª mensagem + toques) e intervalo
--    aleatório do chip (ia_reengajar_proximo_em, o MESMO relógio dos lembretes de 24/72 h).
--  * O texto vem do servidor (modelo com trava ou frase fixa); o banco recusa link, número e texto fora do tamanho.
--  * Nada é agendado aqui: o servidor chama dentro da rota /api/leads/reengajar, que o pg_cron já chama a cada 5 min.
-- Rollback: docs/sql/rollback/20261028190000_leads_ia_toque15.rollback.sql
BEGIN;

-- 1) Configuração por imobiliária ---------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_toque15 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_toque15_min integer NOT NULL DEFAULT 15
    CONSTRAINT lead_config_ia_toque15_min_check CHECK (ia_toque15_min BETWEEN 10 AND 120);
GRANT SELECT (ia_toque15, ia_toque15_min) ON public.lead_config TO authenticated;

-- 2) Marca da conversa (só o servidor grava) -----------------------------------------------------------------------
ALTER TABLE public.lead_conversas ADD COLUMN IF NOT EXISTS toque15_em timestamptz;

-- 3) Horário comercial (seg-sáb, 9h-19h de Brasília), igual ao reengajamento. Separado para o teste conferir as
--    bordas sem depender da hora em que roda. shortcut: feriado não é considerado (igual ao reengajamento).
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_horario(_agora timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT extract(isodow FROM (_agora AT TIME ZONE 'America/Sao_Paulo')) <> 7
     AND extract(hour FROM (_agora AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 9 AND 18
$$;

-- 3b) Envios de hoje da imobiliária (1ª mensagem + lembretes de 24/72 h + toques de 15 min), dia de Brasília.
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_hoje(_org uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT (count(*) FILTER (WHERE (x.primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.reengaje_1_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.reengaje_2_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        + count(*) FILTER (WHERE (x.toque15_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date))::integer
    FROM public.lead_conversas x WHERE x.organization_id = _org
$$;

-- 4) A conversa pode receber o toque agora? (regra única, usada pela lista e pela gravação) -----------------------
-- _ultima: id da última mensagem que o servidor leu; NULL = não confere (só para a lista de candidatas).
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_elegivel(_conversa uuid, _ultima uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _c public.lead_config; _l public.leads; _u record; _cli timestamptz;
BEGIN
  IF NOT public.lead_ia_toque15_horario(now()) THEN RETURN false; END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN false; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _c.organization_id IS NULL OR _l.id IS NULL THEN RETURN false; END IF;
  IF NOT (_c.ia_toque15 AND _c.ia_ativa AND _c.ia_canal = 'ziontalk') THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = _cv.organization_id AND o.status = 'ativa')
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules m WHERE m.organization_id = _cv.organization_id
                     AND m.module = 'leads' AND m.enabled) THEN
    RETURN false;
  END IF;
  -- Conversa ainda com a Nicole, no canal real, 1ª mensagem enviada, sem toque e sem lembrete de 24 h.
  IF _cv.estado <> 'ativa' OR _cv.canal <> 'ziontalk' OR _cv.primeira_enviada_em IS NULL
     OR _cv.toque15_em IS NOT NULL OR _cv.reengaje_1_em IS NOT NULL OR _cv.equipe_em IS NOT NULL THEN
    RETURN false;
  END IF;
  -- Lead aberto, real, sem corretor assumindo.
  IF _l.simulado OR _l.etapa IN ('ganho', 'perdido') OR _l.aceito_em IS NOT NULL THEN RETURN false; END IF;
  -- Lista de liberados e opt-out (mesma regra das respostas e do reengajamento).
  IF NOT (public.lead_ia_contatos(_l.telefone, NULL) && _c.ia_envio_allowlist)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = _cv.organization_id
                 AND op.contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    RETURN false;
  END IF;
  -- O cliente já respondeu ao menos 1 vez (quem nunca respondeu fica com os lembretes de 24/72 h).
  SELECT min(x.created_at) INTO _cli FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id AND x.autor = 'cliente';
  IF _cli IS NULL THEN RETURN false; END IF;
  -- Alguém da equipe registrou algo no lead depois da 1ª mensagem: o corretor assumiu.
  IF EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _cv.lead_id AND e.autor_id IS NOT NULL
              AND e.created_at >= _cv.primeira_enviada_em) THEN
    RETURN false;
  END IF;
  -- Nada pendente na conversa.
  IF EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = _cv.id AND p.status IN ('pendente', 'enviando')) THEN
    RETURN false;
  END IF;
  -- A última mensagem é da Nicole, saiu de verdade, há ia_toque15_min minutos ou mais e antes da janela de 24 h.
  SELECT x.id, x.autor, x.status, x.created_at INTO _u FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id
   ORDER BY x.created_at DESC, x.id DESC LIMIT 1;
  IF _u.id IS NULL OR _u.autor <> 'ia' OR _u.status <> 'enviada' OR _u.created_at <= _cli THEN RETURN false; END IF;
  IF _ultima IS NOT NULL AND _u.id <> _ultima THEN RETURN false; END IF;
  IF _u.created_at > now() - make_interval(mins => _c.ia_toque15_min) THEN RETURN false; END IF;
  IF _u.created_at <= now() - make_interval(hours => _c.ia_reengajar_h1) THEN RETURN false; END IF;
  RETURN true;
END $$;

-- 5) Candidatas (só leitura): no máximo 1 por imobiliária (a parada há mais tempo), só de quem ainda tem limite no
--    dia e com o intervalo do chip livre; até 3 por chamada, com o que o servidor precisa para escrever o texto.
--    Assim uma imobiliária no limite não ocupa a vez das outras nem gera chamadas ao modelo à toa.
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_candidatas()
RETURNS TABLE (conversa_id uuid, lead_id uuid, organization_id uuid, ultima_id uuid, cliente text, ia_nome text,
               org_nome text, redige boolean, provedor text, modelo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT z.conversa_id, z.lead_id, z.organization_id, z.ultima_id, z.cliente, z.ia_nome, z.org_nome, z.redige, z.provedor, z.modelo
  FROM (
  SELECT DISTINCT ON (cv.organization_id) cv.id AS conversa_id, cv.lead_id, cv.organization_id, u.id AS ultima_id,
         CASE WHEN btrim(l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE left(split_part(btrim(coalesce(l.nome, '')), ' ', 1), 40) END AS cliente,
         btrim(c.ia_nome) AS ia_nome, left(coalesce(o.nome, 'imobiliária'), 80) AS org_nome, coalesce(c.ia_redige, false) AS redige,
         c.ia_modelo_provedor AS provedor, c.ia_modelo AS modelo, u.created_at AS em
    FROM public.lead_conversas cv
    JOIN public.lead_config c ON c.organization_id = cv.organization_id
    JOIN public.leads l ON l.id = cv.lead_id
    JOIN public.organizations o ON o.id = cv.organization_id
    JOIN LATERAL (SELECT x.id, x.created_at FROM public.lead_mensagens x WHERE x.conversa_id = cv.id
                   ORDER BY x.created_at DESC, x.id DESC LIMIT 1) u ON true
   WHERE c.ia_toque15 AND cv.estado = 'ativa' AND cv.canal = 'ziontalk' AND cv.toque15_em IS NULL
     AND cv.reengaje_1_em IS NULL
     AND (c.ia_reengajar_proximo_em IS NULL OR c.ia_reengajar_proximo_em <= now())
     AND public.lead_ia_toque15_hoje(cv.organization_id) < c.ia_envio_limite_dia
     AND public.lead_ia_toque15_elegivel(cv.id, u.id)
   ORDER BY cv.organization_id, u.created_at
  ) z
  ORDER BY z.em
  LIMIT 3;
END $$;

-- 6) Grava o toque (pendente) se tudo ainda vale. Devolve o lead (NULL = nada gravado) -----------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_gravar(_conversa uuid, _ultima uuid, _texto text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _c public.lead_config; _t text := btrim(coalesce(_texto, ''));
BEGIN
  IF _conversa IS NULL OR _ultima IS NULL OR char_length(_t) NOT BETWEEN 20 AND 300 THEN
    RAISE EXCEPTION 'Toque invalido' USING ERRCODE = '22023';
  END IF;
  -- Nunca link, preço ou número no toque (nada inventado): o servidor já confere; o banco confere de novo.
  IF _t ~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/))' OR _t ~ '[[:digit:]０-９]' OR _t ~* 'r\$' THEN
    RAISE EXCEPTION 'Toque com link ou numero' USING ERRCODE = '22023';
  END IF;
  -- Nunca convite de visita, agendamento ou horário no toque (t_5335cd2b): o servidor confere; o banco confere de novo.
  IF _t ~* '(visit|agend|marcar|marcamos|hor[aá]rio|conhecer (o|a|esse|essa|este|esta) (im[oó]vel|casa|apartamento|ap|apto|lugar)|pessoalmente)' THEN
    RAISE EXCEPTION 'Toque com convite de visita' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id FOR UPDATE;
  IF _c.ia_reengajar_proximo_em IS NOT NULL AND _c.ia_reengajar_proximo_em > now() THEN RETURN NULL; END IF;
  IF NOT public.lead_ia_toque15_elegivel(_conversa, _ultima) THEN RETURN NULL; END IF;
  -- Limite diário da imobiliária: 1ª mensagem + lembretes de 24/72 h + toques de 15 min.
  IF public.lead_ia_toque15_hoje(_cv.organization_id) >= _c.ia_envio_limite_dia THEN RETURN NULL; END IF;
  IF public.lead_ia_status_saida(_conversa) <> 'pendente' THEN RETURN NULL; END IF;
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
  VALUES (_cv.organization_id, _cv.id, 'ia', left(_t, 300), 'pendente');
  UPDATE public.lead_conversas SET toque15_em = now(), updated_at = now() WHERE id = _cv.id;
  UPDATE public.lead_config
     SET ia_reengajar_proximo_em = now() + make_interval(secs => _c.ia_envio_intervalo_min_s
                                     + floor(random() * (_c.ia_envio_intervalo_max_s - _c.ia_envio_intervalo_min_s + 1)))
   WHERE organization_id = _cv.organization_id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
  VALUES (_cv.organization_id, _cv.lead_id, 'ia', 'toque_15min', 'IA preparou o lembrete rápido (cliente parou de responder).');
  RETURN _cv.lead_id;
END $$;

-- 7) Ligar/desligar na tela (só administrador da própria imobiliária) -----------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_toque15_salvar(_ligado boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _ligado IS NULL THEN RAISE EXCEPTION 'Configuracao da IA invalida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET ia_toque15 = _ligado, updated_at = now() WHERE organization_id = _org;
END $$;

-- 8) Permissões ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.lead_ia_toque15_horario(timestamptz), public.lead_ia_toque15_hoje(uuid), public.lead_ia_toque15_elegivel(uuid, uuid), public.lead_ia_toque15_candidatas(),
  public.lead_ia_toque15_gravar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_toque15_candidatas(), public.lead_ia_toque15_gravar(uuid, uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.lead_ia_toque15_salvar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_ia_toque15_salvar(boolean) TO authenticated, service_role;

COMMIT;
