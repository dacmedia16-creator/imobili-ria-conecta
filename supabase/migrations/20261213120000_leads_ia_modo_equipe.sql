BEGIN;

-- t_45d0f5aa (Denis, 20/11/2026, tópico 6238). Chave nova por imobiliária, nasce DESLIGADA em todas:
--   ia_modo_equipe  (Nicole) não promete corretor, visita marcada nem prazo; diz que vai passar o pedido para a
--                   equipe e, se o cliente reclamar de visita que não aconteceu, reconhece sem assumir compromisso.
-- Feita para o Piloto C2S (passagem ao MAX Principal, sem corretor). Só a coluna: nenhuma função do banco muda.
-- Ligar só no piloto (depois do deploy do código):
--   UPDATE public.lead_config SET ia_modo_equipe = true WHERE organization_id = 'c2c2c2c2-0000-4000-8000-000000000001';
-- Desligar = UPDATE public.lead_config SET ia_modo_equipe = false WHERE organization_id = '<org>';

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_modo_equipe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lead_config.ia_modo_equipe IS
  't_45d0f5aa: Nicole sem prometer corretor/visita/prazo (passa o pedido para a equipe). Padrão desligado.';

COMMIT;
