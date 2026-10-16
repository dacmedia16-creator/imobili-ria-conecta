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
- SQL do cruzamento corretor → perfil (`20261016210000_remax_xml_brokers`): `supabase/tests/remax_xml_brokers.sql`,
  mesmo container (migrations 20261016200000 + 20261016210000 juntas em `/tmp/mig_body.sql`); esperado `TOTAL 42/42`.

## Corretores do XML → perfis (20261016210000, t_e8265cce)
- A cada coleta boa, um gatilho em `remax_xml_runs` guarda o cadastro do corretor do XML (`remax_xml_brokers`:
  ID, nome, e-mail, telefone) e cruza com `profiles` ativos da mesma imobiliária, nesta ordem:
  1) ID RE/MAX; 2) e-mail normalizado; 3) telefone normalizado (sem DDI 55, sem 0, sem o 9º dígito; telefone que
  aparece em mais de um corretor do XML, como o do escritório, não liga).
- Vínculo novo vai para `remax_xml_broker_vinculos` com a origem (`id`, `email`, `telefone`, `admin`). Nada é
  sobrescrito nem apagado: `profiles` não é alterado e vínculo existente continua valendo.
- Dúvida não liga e vai para `remax_xml_broker_revisao` com o motivo: e-mail/telefone em vários perfis, ID e contato
  apontando para perfis diferentes, perfil que já tem outro ID RE/MAX, mesmo perfil para dois corretores do XML,
  e-mail e telefone divergentes, vínculo existente diferente do novo cruzamento (só aviso).
- Leitura: admin, super_admin, gestor e financeiro da própria imobiliária (mesma regra de acesso de `profiles`).
  Escrita só pelo servidor; o admin resolve a revisão com `remax_xml_revisao_resolver(id, 'confirmar_id'|'encerrar')`.
- Números sem dado pessoal: `scripts/remax-xml-brokers-numeros.py` (Postgres local descartável, BEGIN/ROLLBACK).
  Com o XML de 15/10/2026 e os 169 perfis ativos da Única Escolha: 111 corretores com anúncio de venda,
  59 por ID, 41 por e-mail, 0 por telefone, 0 em conflito, 11 sem correspondência; 659 de 699 anúncios com corretor.
- Rollback: `supabase/rollback/20261016210000_remax_xml_brokers.sql` (volta o cruzamento calculado na hora;
  apaga cadastro, vínculos e revisão).
