
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

-- Migrar coordenador -> gestor (evita duplicidade quando já é gestor)
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'gestor'::public.app_role FROM public.user_roles WHERE role = 'coordenador'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles WHERE role = 'coordenador';
