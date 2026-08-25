-- Importa apenas correspondencias inequivocas entre a lista Posicionamento 2026
-- e corretores ativos ja cadastrados. A autorizacao de exposicao publica foi
-- confirmada pelo responsavel da operacao em 2026-08-25.
BEGIN;

CREATE TEMP TABLE desired_positioning_import (
  profile_name text NOT NULL,
  region_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO desired_positioning_import (profile_name, region_name) VALUES
  ('Carlos Eduardo Carneiro', 'Jardim Santa Esmeralda'),
  ('Ana Emilia Vitório de Mendonça', 'Vila Helena'),
  ('Kelly Vasconcelos', 'Jardim Santa Catarina'),
  ('Joana D''arc Gadelha Nicolodi', 'Jardim São Guilherme'),
  ('Bruna Kraft', 'Ibiti Reserva'),
  ('Claudemir Cesar', 'Jardim São Guilherme'),
  ('Flavio Galoro', 'Parque Campolim'),
  ('Jorge Alvarenga', 'Jardim Vergueiro'),
  ('Leonardo Capura', 'Jardim Faculdade'),
  ('Edilene Lima', 'Mont Blanc'),
  ('Eduardo Antonio Reina', 'Campolim'),
  ('Luciano Albuquerque', 'Mont Blanc'),
  ('Luciano Albuquerque', 'Giverny'),
  ('Luciano Albuquerque', 'Santa Maria'),
  ('Edson Alves', 'Parque Campolim'),
  ('Gustavo Fuentes', 'Alphavilles'),
  ('Gustavo Fuentes', 'Saint Patrick'),
  ('Gustavo Fuentes', 'Fazenda Imperial'),
  ('Maria do Carmo Pellegrini', 'Fazenda Imperial'),
  ('Elaine Moraes Dos Santos', 'Parque Campolim'),
  ('Donizeti Cosme', 'Parque Campolim'),
  ('Wanderley Hiro Sato', 'Jardim América'),
  ('Goreti Vilela', 'Jardim Piratininga'),
  ('Irineu Ferro', 'Vila Haro'),
  ('Alexandra Ueda', 'Alto da Boa Vista'),
  ('Eduardo Flores', 'Alto da Boa Vista'),
  ('Ana Caroline Soares', 'Vila Amato'),
  ('Robson Sorrilha', 'Granja Olga'),
  ('Orlando Menck da Silva', 'Jardim São Paulo'),
  ('Pamela Cristine Campos Lisboa  Siqueira', 'Wanel Ville'),
  ('Elisiane Aparecida Rodrigues Paulino', 'Júlio de Mesquita'),
  ('Edvaldo Lima', 'Jardim Europa'),
  ('Rodrigo Guimarães Ham', 'Cidade Jardim'),
  ('Ronnieri Murilo Almeida Silva', 'Vila Barão'),
  ('Elaine Miguel Rodrigues', 'Centro'),
  ('Katia Leamari', 'Caguaçu'),
  ('Alex Rocha', 'Caguaçu'),
  ('Wellington de Oliveira', 'Zona Industrial'),
  ('Felipe de Bortoli Zulli', 'Villa Flora'),
  ('Wilson Grecchi Junior', 'Belvedere 2'),
  ('Kathia Sato', 'Araçoiaba da Serra');

DO $$
DECLARE
  unresolved_profiles text;
  unresolved_regions text;
BEGIN
  SELECT string_agg(DISTINCT d.profile_name, ', ' ORDER BY d.profile_name)
  INTO unresolved_profiles
  FROM desired_positioning_import d
  LEFT JOIN public.profiles p
    ON p.nome = d.profile_name
    AND p.ativo
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
    )
  WHERE p.id IS NULL;

  IF unresolved_profiles IS NOT NULL THEN
    RAISE EXCEPTION 'Corretores do lote nao resolvidos: %', unresolved_profiles;
  END IF;

  SELECT string_agg(DISTINCT d.region_name, ', ' ORDER BY d.region_name)
  INTO unresolved_regions
  FROM desired_positioning_import d
  LEFT JOIN public.positioning_regions r ON r.nome = d.region_name AND r.ativo
  WHERE r.id IS NULL;

  IF unresolved_regions IS NOT NULL THEN
    RAISE EXCEPTION 'Regioes do lote nao resolvidas: %', unresolved_regions;
  END IF;
END;
$$;

INSERT INTO public.corretor_positioning_regions (corretor_id, region_id)
SELECT p.id, r.id
FROM desired_positioning_import d
JOIN public.profiles p ON p.nome = d.profile_name AND p.ativo
JOIN public.positioning_regions r ON r.nome = d.region_name AND r.ativo
ON CONFLICT (corretor_id, region_id) DO NOTHING;

UPDATE public.profiles p
SET public_profile_enabled = true
WHERE p.nome IN (SELECT DISTINCT profile_name FROM desired_positioning_import)
  AND p.ativo
  AND nullif(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), '') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
  );

COMMIT;
