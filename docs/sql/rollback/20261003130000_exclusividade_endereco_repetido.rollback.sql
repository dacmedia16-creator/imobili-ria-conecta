BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_address_conflicts(uuid);
DROP FUNCTION IF EXISTS public.exclusive_norm_address(text);
COMMIT;
