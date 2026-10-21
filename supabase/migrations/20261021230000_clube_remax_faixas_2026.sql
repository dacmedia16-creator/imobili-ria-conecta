-- Clubes RE/MAX 2026 em todas as imobiliárias (t_442b9c66).
-- Denis (tópico 6238, 21/10/2026): "1- sim (vale para 2026) / 2- em todas".
-- Somente dados: insere as 7 faixas de 2026 por organização. A tabela 2025 fica intacta (histórico).
-- ON CONFLICT DO NOTHING: não sobrescreve faixas de 2026 já editadas pela tela.
BEGIN;

INSERT INTO public.clube_remax_faixas (organization_id, ano, ordem, nome, vgc_minimo, origem)
SELECT o.id, 2026, f.ordem, f.nome, f.minimo, 'Tabela de referência 2026'
  FROM public.organizations o
 CROSS JOIN (VALUES (1, 'Executive', 167224), (2, '100%', 334448), (3, 'Platinum', 836120),
                    (4, 'Chairman''s', 1672241), (5, 'Titan', 2508361), (6, 'Diamond', 3344482),
                    (7, 'Pinnacle', 6688963)) AS f(ordem, nome, minimo)
ON CONFLICT DO NOTHING;

COMMIT;
