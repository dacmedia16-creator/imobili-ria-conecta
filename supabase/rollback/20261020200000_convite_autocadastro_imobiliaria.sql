-- Rollback de 20261020200000_convite_autocadastro_imobiliaria.sql (t_6e4dab96).
-- Remove só o que a migration criou. Imobiliárias e usuários já criados por convites aceitos
-- CONTINUAM existindo (são dados reais); só o histórico dos convites é apagado.
-- Vínculos Conta MAX criados no aceite também ficam (o dono continua entrando com Google).
BEGIN;
DROP FUNCTION IF EXISTS public.org_invite_accept_undo(uuid);
DROP FUNCTION IF EXISTS public.org_invite_accept_finish(uuid, uuid);
DROP FUNCTION IF EXISTS public.org_invite_accept(text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.org_invite_claim_info(text);
DROP FUNCTION IF EXISTS public.org_invite_claim(text, text, text, text);
DROP FUNCTION IF EXISTS public.org_invite_email_data(uuid);
DROP FUNCTION IF EXISTS public.org_invite_mark_sent(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.org_invite_cancel(uuid, uuid);
DROP FUNCTION IF EXISTS public.org_invite_resend(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.org_invite_create(text, text, uuid, interval);
DROP FUNCTION IF EXISTS public.org_invite_email_em_uso(text);
DROP TABLE IF EXISTS public.organization_invites;
COMMIT;
