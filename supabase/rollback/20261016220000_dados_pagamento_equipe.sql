-- Rollback da migration 20261016220000_dados_pagamento_equipe.sql (card t_a4ef3b48).
-- Remove as RPCs, as tabelas de dados de pagamento da equipe (cadastro do corretor e cópia por venda)
-- e as funções auxiliares. ATENÇÃO: os dados bancários/PIX digitados pelos corretores são perdidos;
-- se já houver uso real, exporte antes (somente com autorização). Não toca em sale_bank_accounts nem
-- nos campos da parceria externa.
BEGIN;
DROP FUNCTION IF EXISTS public.venda_dados_pagamento(uuid);
DROP FUNCTION IF EXISTS public.salvar_meus_dados_pagamento_venda(uuid, text, boolean, jsonb, boolean);
DROP FUNCTION IF EXISTS public.sale_equipe_pagamento(uuid);
DROP FUNCTION IF EXISTS public.pagamento_mascarar(text);
DROP TABLE IF EXISTS public.sale_dados_pagamento;
DROP TABLE IF EXISTS public.corretor_dados_pagamento;
DROP FUNCTION IF EXISTS public.dados_pagamento_touch();
COMMIT;
