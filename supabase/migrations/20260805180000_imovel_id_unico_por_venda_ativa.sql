-- Nada impedia duas vendas com o mesmo código de imóvel (achado real: um rascunho novo foi criado
-- por engano pro mesmo imóvel de uma venda já em andamento). Índice único PARCIAL — só entre vendas
-- "ativas" (fora arquivada/cancelada) — pra ainda permitir vender o mesmo imóvel de novo no futuro,
-- caso o negócio anterior tenha caído.
CREATE UNIQUE INDEX sales_imovel_id_ativa_key ON public.sales (imovel_id)
  WHERE imovel_id IS NOT NULL AND status NOT IN ('arquivada', 'cancelada');
