-- Desfaz 20261226120000_remover_tabelas_backup_esquecidas (t_f4137af5): recria as 2 tabelas com a mesma estrutura,
-- RLS e grants. Os DADOS (8 linhas da bkp_carreira_plano_2027_zerar; a outra estava vazia) NÃO ficam no repositório:
-- vêm do dump protegido na VPS. Caminho completo, com os INSERTs, pronto em:
--   /root/.config/max/adm-max-prod-backups/t_f4137af5-reverter.sql
-- ou: pg_restore -t das 2 tabelas a partir de
--   /root/.config/max/adm-max-prod-backups/t_f4137af5-2tabelas-backup-20261123T013820Z.dump
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE TABLE public.bkp_carreira_plano_2027_zerar (
    copiado_em timestamp with time zone,
    id uuid,
    organization_id uuid,
    user_id uuid,
    ano integer,
    trilha text,
    ativacao_inicio date,
    respostas jsonb,
    assinado_corretor_em timestamp with time zone,
    assinado_broker_em timestamp with time zone,
    assinado_broker_por uuid,
    meta_oficial jsonb,
    meta_oficial_em timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);
CREATE TABLE public.locacao_config_sf_backup (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    itens jsonb NOT NULL,
    salvo_em timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.bkp_carreira_plano_2027_zerar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_config_sf_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_carreira_plano_2027_zerar FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.locacao_config_sf_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bkp_carreira_plano_2027_zerar TO service_role;
GRANT ALL ON TABLE public.locacao_config_sf_backup TO service_role;

COMMIT;
