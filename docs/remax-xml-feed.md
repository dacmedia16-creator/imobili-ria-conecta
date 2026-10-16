# Coleta diária do XML VRSync RE/MAX → OLX

Base de imóveis do Feedback e do mapa de captações (t_698be0d2 / t_b9e412bc).

## Como funciona
- Task Nitro `remax-xml-collect` (`server/tasks/remax-xml-collect.ts`), agendada em `nitro.config.ts`
  para `40 6 * * *` (1x/dia, scheduler do próprio Worker, custo R$ 0).
- Parser: `src/lib/remax-xml.ts`.
  - `listarAnunciosVrsync` / `contagemVrsync`: todos os anúncios (venda e aluguel) com código, transação,
    escritório (`OfficeName`), ID RE/MAX (9 dígitos iniciais do código) e contato (`Name`, `Email`, `Telephone`).
  - `parseVrsync`: só venda (`For Sale`) segue para o banco; aluguel nunca é gravado.
  - `codeKey`: mesma chave de `public.portal_code_key` / `portal_listing_snapshots`
    (`630601201-93` = `630601201x93` = `630601201XX093`).
- Banco: migration `supabase/migrations/20261016200000_remax_xml_feed.sql`
  (rollback em `supabase/rollback/` com o mesmo nome). **Não aplicada em produção.**

## Configuração (por organização, fora do git)
Secrets do Worker, configurados pelo MAX Principal no momento da ativação:
- `REMAX_XML_FEEDS` = `{"<organization_id>": "https://<URL_PRIVADA_DO_XML>"}` (JSON; uma entrada por imobiliária).
- `REMAX_XML_COLLECT` = `on` para ligar. Sem isso a task responde `disabled`.

A URL tem código de acesso: nunca vai para o banco, o git, a UI ou os logs. Erros são gravados com a URL
substituída por `[url]` e sem dados de corretor.

## Robustez (última versão boa)
A coleta é registrada em `remax_xml_runs` e consultada pela UI via `remax_xml_status()` (campo `aviso`).
- Download falhou, HTTP de erro ou arquivo que não é VRSync → run `failed`; nada é gravado.
- XML sem anúncios de venda → run `rejeitado`.
- **Limiar de queda brusca:** se a última coleta boa tinha 20 ou mais imóveis de venda e a nova tem menos
  da metade (`novo < anterior / 2`), a coleta é `rejeitado`.
- Em qualquer desses casos a última versão boa continua valendo e a UI mostra o aviso. Os dados nunca são zerados.
- Anúncios que saem do XML ficam guardados por 60 dias (`last_seen`) antes da limpeza, e só na própria organização.

## Testes
- `npx vitest run src/lib/remax-xml.test.ts`: usa a fixture anonimizada `src/lib/__fixtures__/vrsync-remax-amostra.xml`.
- Conferência com o XML real (arquivo local, não versionado):
  `REMAX_XML_SAMPLE=/caminho/feed.xml npx vitest run src/lib/remax-xml.test.ts`.
  No arquivo de 15/10/2026: 1.449 anúncios (699 venda, 750 aluguel), 125 corretores e e-mail em 1.449.
- SQL (fallback, permissões e isolamento por organização): `supabase/tests/remax_xml_feed.sql`, em container
  local com o schema de produção; esperado `TOTAL 38/38`.
