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

Marco 1c: `bash supabase/multiempresa/run-1c.sh` após 1a+1b no container local
`adm-mt-clone`. As quatro buckets recebem caminhos novos `<organization_id>/...`;
objetos legados da Única Escolha ficam no caminho físico original, somente leitura
(e remoção autorizada). Não alterar `storage.objects.name` via SQL para mover blobs.
O down bloqueia agência nova ou objeto prefixado até reconciliação/backup.
`avatars` continua público para URLs públicas históricas: suas URLs não passam por
RLS; a separação de caminhos não equivale à privacidade da imagem.

Marco 1d: `bash supabase/multiempresa/run-1d.sh` após 1a+1b+1c. Sobe PostgREST local
(`local-rest.sh`, só 127.0.0.1, JWT efêmero fora do repo), aplica a migration 1d, roda as suítes
SQL 1a–1d, a fixture sintética A↔B e `src/lib/multiempresa-1d.integration.test.ts`; limpa a fixture,
ensaia o rollback (fingerprint idêntico) e reaplica. Nenhum WhatsApp é enviado.

Ensaio completo (recria container local, upgrade, testes, rollback, reaplicação):

    CATALOG_DIR=/caminho/privado/catalog bash supabase/multiempresa/run-1a.sh
