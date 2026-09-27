# Multiempresa ADM MAX — Fase 1 (somente local)

Nada aqui é aplicado por `supabase db push`: os arquivos ficam fora de `supabase/migrations` de propósito.
Aplicar em homologação/produção só com aprovação expressa de Denis.

- `build_clone.py` — gera o clone estrutural (41 tabelas, 108+17 policies, 143 funções, triggers, grants, buckets)
  a partir do catálogo extraído em modo somente leitura. O catálogo e o SQL gerado ficam **fora do repo**
  (`.git/info/exclude`); nunca commitar.
- `clone-bootstrap.sql` — mínimo de `storage`/`auth` que a imagem local não traz.
- `migrations/20260928000000_mt_fase1a_fundacao.sql` (+ `.down.sql`) — marco 1a.
- `tests/seed_legacy.sql` — dados sintéticos do legado; `tests/isolation_1a.sql` — testes A↔B (transação + ROLLBACK).
- `fingerprint.sql`, `verify_clone.sql` — conferência de fidelidade e do rollback.

Ensaio completo (recria container local, upgrade, testes, rollback, reaplicação):

    CATALOG_DIR=/caminho/privado/catalog bash supabase/multiempresa/run-1a.sh
