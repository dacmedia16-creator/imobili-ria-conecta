-- Locação: agendamento da vistoria + avisos de WhatsApp ao corretor antes e depois (t_c3ea1b18, Denis 20/11/2026).
--  1) A vistoria (papel vistoria; admin também) agenda: data e hora (horário de Brasília), nome do vistoriador e se o
--     corretor acompanha. Fica em locacoes.pos->'vistoria_agenda' (sem coluna nova). Agendar também marca
--     "vistoria pedida" (se ainda não estava). Reagendar troca a data e EXPIRA o lembrete pendente da data antiga.
--  2) Lembretes ao corretor responsável: na véspera (a partir de 24 h antes) e ~2 h antes, com horário, endereço e se
--     ele acompanha. Quem gera é locacao_vistoria_lembretes_gerar(), chamada pelo servidor na MESMA rota que o pg_cron
--     já chama a cada 5 min (/api/leads/reengajar): nenhum agendador novo. A chave do aviso leva a data/hora agendada,
--     então o mesmo lembrete nunca sai duas vezes e o da data antiga não volta.
--  3) Laudo registrado (pos.laudo_em preenchido): aviso "vistoria concluída" com o prazo de contestação do locatário
--     (10 dias corridos contados da entrega das chaves, cláusula 15ª dos modelos de contrato).
-- Mesma fila locacao_avisos (chave única, máx. 5 por envio, só avisos de até 24 h) e mesma trava do envio
-- (LOCACAO_AVISOS_WHATSAPP = on no Worker). Esta migration NÃO agenda nada e NÃO envia nada.
-- Rollback: supabase/rollback/20261214120000_locacao_vistoria_agenda.sql
BEGIN;

-- 1) Novos eventos na fila -------------------------------------------------------------------------------------------
ALTER TABLE public.locacao_avisos DROP CONSTRAINT locacao_avisos_evento_check;
ALTER TABLE public.locacao_avisos ADD CONSTRAINT locacao_avisos_evento_check
  CHECK (evento IN ('minuta_enviada', 'pendencia', 'ajuste', 'devolvida', 'andamento',
                    'vistoria_vespera', 'vistoria_2h', 'vistoria_concluida'));

-- Texto "21/11 (sex) às 14:00" no horário de Brasília.
CREATE FUNCTION public.locacao_vistoria_quando(_em timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT to_char(_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') || ' ('
    || (ARRAY['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])[extract(dow FROM _em AT TIME ZONE 'America/Sao_Paulo')::int + 1]
    || ') às ' || to_char(_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
$$;

-- 2) Agendar / reagendar ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.locacao_vistoria_agendar(_id uuid, _quando text, _vistoriador text, _acompanha boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _em timestamptz; _v text := btrim(coalesce(_vistoriador, ''));
  _antes timestamptz; _p jsonb; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves'], 'vistoria');
  IF _l.pos->>'laudo_em' IS NOT NULL THEN
    RAISE EXCEPTION 'Laudo já registrado: a vistoria já aconteceu.' USING ERRCODE = '22023';
  END IF;
  IF _quando IS NULL OR _quando !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$' THEN
    RAISE EXCEPTION 'Informe a data e a hora da vistoria.' USING ERRCODE = '22023';
  END IF;
  _em := replace(_quando, 'T', ' ')::timestamp AT TIME ZONE 'America/Sao_Paulo';
  IF _em <= now() OR _em > now() + interval '180 days' THEN
    RAISE EXCEPTION 'Data da vistoria inválida (precisa ser no futuro, até 180 dias).' USING ERRCODE = '22023';
  END IF;
  IF length(_v) < 2 OR length(_v) > 80 THEN
    RAISE EXCEPTION 'Informe o nome do vistoriador.' USING ERRCODE = '22023';
  END IF;
  IF _acompanha IS NULL THEN
    RAISE EXCEPTION 'Informe se o corretor acompanha a vistoria.' USING ERRCODE = '22023';
  END IF;
  _antes := (_l.pos->'vistoria_agenda'->>'em')::timestamptz;
  _p := coalesce(_l.pos, '{}'::jsonb)
    || jsonb_build_object('vistoria_agenda', jsonb_build_object('em', _em, 'vistoriador', _v, 'acompanha', _acompanha),
                          'vistoria_pedida', coalesce(_l.pos->>'vistoria_pedida', _hoje::text));
  UPDATE public.locacoes SET pos = _p, atualizado_em = now() WHERE id = _l.id RETURNING * INTO _l;
  -- Reagendou: o lembrete que ainda não saiu da data antiga expira (não apaga; fica o histórico).
  IF _antes IS DISTINCT FROM _em THEN
    UPDATE public.locacao_avisos SET status = 'expirado', erro = 'vistoria reagendada'
     WHERE locacao_id = _l.id AND evento IN ('vistoria_vespera', 'vistoria_2h') AND status = 'pendente';
  END IF;
  PERFORM public.locacao_evento(_l, 'vistoria',
    CASE WHEN _antes IS NULL THEN 'Vistoria agendada para ' ELSE 'Vistoria reagendada para ' END
    || public.locacao_vistoria_quando(_em) || ' — vistoriador ' || _v
    || CASE WHEN _acompanha THEN ' — corretor acompanha' ELSE ' — corretor não acompanha' END);
  RETURN jsonb_build_object('ok', true, 'em', _em);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Data da vistoria inválida.' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_vistoria_agendar(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_vistoria_agendar(uuid, text, text, boolean) TO authenticated;

-- 3) Lembretes (só o servidor chama, pela rota do pg_cron) ------------------------------------------------------------
-- Véspera: a vistoria é amanhã (ou faltam menos de 24 h) e ainda faltam mais de 2 h. O pg_cron de produção roda de
-- segunda a sábado, das 9h às 18h55; por isso, no sábado, a vistoria de segunda também conta como "amanhã" (senão
-- ninguém avisaria no domingo). 2 h antes: das 2 h antes até a hora marcada. Uma janela exclui a outra, então numa
-- rodada sai no máximo um; se a véspera não saiu a tempo (agendada em cima da hora), sai só o de 2 h.
-- Devolve as locações com aviso de vistoria pendente (o servidor envia em seguida pela fila de sempre).
CREATE FUNCTION public.locacao_vistoria_lembretes_gerar(_limite integer DEFAULT 20) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r record; _ev text; _txt text; _a jsonb;
BEGIN
  FOR _r IN
    SELECT l.*, (l.pos->'vistoria_agenda'->>'em')::timestamptz AS em
      FROM public.locacoes l
     WHERE l.situacao = 'ativa' AND l.etapa IN ('pos_assinatura', 'chaves')
       AND l.pos->>'laudo_em' IS NULL AND l.pos->'vistoria_agenda'->>'em' IS NOT NULL
       AND (l.pos->'vistoria_agenda'->>'em')::timestamptz > now()
       AND ((l.pos->'vistoria_agenda'->>'em')::timestamptz <= now() + interval '24 hours'
         OR ((l.pos->'vistoria_agenda'->>'em')::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
               + CASE WHEN extract(dow FROM now() AT TIME ZONE 'America/Sao_Paulo') = 6 THEN 2 ELSE 1 END)
       -- Sem isto, as mesmas primeiras _limite agendas entram em TODA rodada e as demais nunca são atendidas.
       -- A chave inclui o horário: o lembrete da nova data reaparece, o da antiga nunca é recriado.
       AND NOT EXISTS (
         SELECT 1 FROM public.locacao_avisos a WHERE a.chave = l.id::text || ':' ||
           CASE WHEN (l.pos->'vistoria_agenda'->>'em')::timestamptz <= now() + interval '2 hours'
             THEN 'vistoria_2h' ELSE 'vistoria_vespera' END || ':' ||
           extract(epoch FROM (l.pos->'vistoria_agenda'->>'em')::timestamptz)::bigint::text)
     ORDER BY em LIMIT least(greatest(coalesce(_limite, 20), 1), 50)
  LOOP
    _a := _r.pos->'vistoria_agenda';
    _ev := CASE WHEN _r.em <= now() + interval '2 hours' THEN 'vistoria_2h' ELSE 'vistoria_vespera' END;
    _txt := CASE WHEN _ev = 'vistoria_2h' THEN 'Vistoria daqui a pouco: ' ELSE 'Lembrete: vistoria ' END
      || public.locacao_vistoria_quando(_r.em) || '. '
      || CASE WHEN (_a->>'acompanha')::boolean
           THEN 'Você vai ACOMPANHAR a vistoria' || coalesce(' (vistoriador: ' || nullif(_a->>'vistoriador', '') || ')', '') || '.'
           ELSE 'Você NÃO precisa acompanhar.' END;
    BEGIN
      PERFORM public.locacao_aviso_novo((SELECT l FROM public.locacoes l WHERE l.id = _r.id), _ev,
        _r.id::text || ':' || _ev || ':' || extract(epoch FROM _r.em)::bigint::text, _txt);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'locacao_vistoria_lembretes_gerar: % %', SQLSTATE, SQLERRM; -- uma locação nunca trava as outras
    END;
  END LOOP;
  RETURN QUERY
    SELECT DISTINCT a.locacao_id FROM public.locacao_avisos a
     WHERE a.status = 'pendente' AND a.evento IN ('vistoria_vespera', 'vistoria_2h')
       AND a.criado_em >= now() - interval '24 hours'
     LIMIT least(greatest(coalesce(_limite, 20), 1), 50);
END $$;
REVOKE ALL ON FUNCTION public.locacao_vistoria_lembretes_gerar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_vistoria_lembretes_gerar(integer) TO service_role;

-- Checagem imediatamente antes da rede: o envio reservado pode ter ficado obsoleto se reagendaram ou registraram
-- o laudo enquanto a chamada ao servidor aguardava. Só service_role vê a fila e chama esta função.
CREATE FUNCTION public.locacao_vistoria_aviso_atual(_aviso uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT a.status = 'enviando' AND l.situacao = 'ativa'
      AND l.pos->>'laudo_em' IS NULL AND (l.pos->'vistoria_agenda'->>'em')::timestamptz > now()
      AND a.chave = l.id::text || ':' || a.evento || ':' ||
        extract(epoch FROM (l.pos->'vistoria_agenda'->>'em')::timestamptz)::bigint::text
      AND (a.evento <> 'vistoria_vespera' OR
        (l.pos->'vistoria_agenda'->>'em')::timestamptz > now() + interval '2 hours')
    FROM public.locacao_avisos a JOIN public.locacoes l ON l.id = a.locacao_id
    WHERE a.id = _aviso AND a.evento IN ('vistoria_vespera', 'vistoria_2h')), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_vistoria_aviso_atual(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_vistoria_aviso_atual(uuid) TO service_role;

-- 4) Laudo registrado → "vistoria concluída" com o prazo de contestação ---------------------------------------------
CREATE FUNCTION public.locacao_trg_avisos_vistoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _laudo date;
BEGIN
  BEGIN
    _laudo := (NEW.pos->>'laudo_em')::date;
    -- Lembrete que ainda não saiu perde o sentido.
    UPDATE public.locacao_avisos SET status = 'expirado', erro = 'laudo registrado'
     WHERE locacao_id = NEW.id AND evento IN ('vistoria_vespera', 'vistoria_2h') AND status = 'pendente';
    -- shortcut: prazo fixo de 10 dias corridos da cláusula 15ª dos modelos atuais; se a imobiliária mudar a cláusula,
    -- o texto precisa acompanhar.
    PERFORM public.locacao_aviso_novo(NEW, 'vistoria_concluida', NEW.id::text || ':vistoria_concluida:' || _laudo::text,
      'Vistoria concluída: laudo registrado em ' || to_char(_laudo, 'DD/MM/YYYY') || '. O locatário tem 10 dias corridos, '
      || 'contados da entrega das chaves, para contestar o laudo'
      || coalesce(' (até ' || to_char(NEW.chave_em + 10, 'DD/MM/YYYY') || ')', '') || '.');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'locacao_trg_avisos_vistoria: % %', SQLSTATE, SQLERRM; -- aviso nunca trava a ação de quem clicou
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER locacao_zz_avisos_vistoria AFTER UPDATE OF pos ON public.locacoes
  FOR EACH ROW WHEN (OLD.pos->>'laudo_em' IS NULL AND NEW.pos->>'laudo_em' IS NOT NULL)
  EXECUTE FUNCTION public.locacao_trg_avisos_vistoria();

REVOKE ALL ON FUNCTION public.locacao_vistoria_quando(timestamptz), public.locacao_trg_avisos_vistoria()
  FROM PUBLIC, anon, authenticated;

COMMIT;
