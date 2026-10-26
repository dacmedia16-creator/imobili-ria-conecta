-- Tour guiado: abre sozinho nos 3 primeiros ACESSOS (antes só no 1º). Card t_7444a154, pedido de Denis
-- em 26/10/2026, tópico 6238.
--
-- ADITIVA e idempotente: só acrescenta 2 colunas, aceita um status novo ('aberto') e cria 1 função.
-- Não apaga nem altera dado existente além de contar como 1 abertura quem já tinha linha.
-- Rollback: docs/sql/rollback/20261026150000_tour_tres_aberturas.rollback.sql
--
-- Regras:
--  1) aberturas = quantas vezes o tour abriu SOZINHO para a pessoa (o botão "Ver tour de novo" não conta).
--  2) Quem já tinha linha antes desta migration (viu o tour na versão de 1 abertura) fica com 1.
--  3) public.tour_registrar_abertura(tour) soma 1 de forma atômica e devolve true só se pode abrir:
--     menos de 3 aberturas E a última abertura automática foi há 30 min ou mais (várias abas/reentrada
--     rápida contam como o mesmo acesso). O "1 por sessão" (recarregar não conta) fica na tela.
--  4) SECURITY INVOKER: roda com a RLS de sempre (só a própria linha, user_id = auth.uid()).
BEGIN;

-- Coluna nova entra com DEFAULT 1 para as linhas que JÁ existem (quem já viu = 1 abertura) e depois o
-- padrão passa a 0 para linhas novas. Se a coluna já existir, nada é recontado.
ALTER TABLE public.user_tour_estado
  ADD COLUMN IF NOT EXISTS aberturas integer NOT NULL DEFAULT 1;
ALTER TABLE public.user_tour_estado ALTER COLUMN aberturas SET DEFAULT 0;

ALTER TABLE public.user_tour_estado
  ADD COLUMN IF NOT EXISTS ultima_abertura_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_tour_estado'::regclass AND conname = 'user_tour_estado_aberturas_check'
  ) THEN
    ALTER TABLE public.user_tour_estado
      ADD CONSTRAINT user_tour_estado_aberturas_check CHECK (aberturas BETWEEN 0 AND 1000);
  END IF;
END $$;

-- Status ganha 'aberto' (tour abriu sozinho e ainda não foi concluído/fechado). Só amplia a lista.
ALTER TABLE public.user_tour_estado DROP CONSTRAINT IF EXISTS user_tour_estado_status_check;
ALTER TABLE public.user_tour_estado
  ADD CONSTRAINT user_tour_estado_status_check CHECK (status IN ('aberto', 'concluido', 'fechado'));

COMMENT ON COLUMN public.user_tour_estado.aberturas IS
  'Quantas vezes o tour abriu sozinho (máx. 3 automáticas; t_7444a154). Botão não conta.';
COMMENT ON COLUMN public.user_tour_estado.ultima_abertura_em IS
  'Quando o tour abriu sozinho pela última vez (trava de 30 min entre aberturas automáticas).';

CREATE OR REPLACE FUNCTION public.tour_registrar_abertura(p_tour text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok  boolean := false;
BEGIN
  IF v_uid IS NULL OR p_tour IS NULL OR p_tour !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_tour_estado AS t (user_id, tour, status, aberturas, ultima_abertura_em)
  VALUES (v_uid, p_tour, 'aberto', 1, now())
  ON CONFLICT (user_id, tour) DO UPDATE
    SET aberturas = t.aberturas + 1,
        ultima_abertura_em = now(),
        atualizado_em = now()
    WHERE t.aberturas < 3
      AND (t.ultima_abertura_em IS NULL OR t.ultima_abertura_em <= now() - interval '30 minutes')
  RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.tour_registrar_abertura(text) IS
  'Soma 1 abertura automática do tour da própria pessoa; true = pode abrir (t_7444a154).';

REVOKE ALL ON FUNCTION public.tour_registrar_abertura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tour_registrar_abertura(text) TO authenticated;

COMMIT;
