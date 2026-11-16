# Plano único de publicação — Locação PR #329 (modelos) + PR #330 (reunião 16/11)

Branch de integração: `feat/locacao-integracao-329-330-t_6feb2df6` (main 7cc8cb3 + #329 + #330). Cartão t_6feb2df6.
**NÃO executar sem "pode publicar" do Denis.** Envio real de WhatsApp só começa depois deste plano.

## O que entra junto
- Migration 1: `20261201120000_locacao_modelos_contrato.sql` (modelos por garantia, editor, apólice, trava das chaves).
- Migration 2: `20261201150000_locacao_reuniao_16_11.sql` (tipo do imóvel, equipe/Gestor/TL, lançamento, clientes, avisos WhatsApp).
- Frontend do Worker (`npm run deploy:safe`). Nenhuma Edge Function muda.
- As duas migrations não redefinem nenhuma função em comum. A ordem é obrigatória: 120000 → 150000. O rollback é inverso: 150000 → 120000.

## Atenção antes de publicar
- **WhatsApp real:** no Worker de produção existe `ZIONTALK_API_KEY`. Depois do deploy, cada ação da locação gera um aviso na fila e ele SAI de verdade (no máximo 5 por chamada, até 24 h). Para publicar sem envio, confirme antes com Denis.
- Locação nº 12, Única Escolha e `locacao_config` não são tocados por SQL manual. As migrations só criam ou ajustam estrutura. Confirme com o md5 abaixo.
- Decisões pendentes da Cris (não bloqueiam o código): trava de chaves pelo lançamento (hoje não trava), parceria RE/MAX 50/50 e se o aluguel/taxa lançados substituem o da ficha (hoje substituem). Dúvidas da Larissa: Porto IGP-M e o comercial com outra garantia.

## Passo a passo
1. **Main sem mudança:** `git fetch`. Se a main andou além de 7cc8cb3, faça merge na branch e procure `CREATE OR REPLACE FUNCTION` das mesmas funções nas migrations novas. Refaça se houver colisão.
2. **Funções no ar = base esperada:** compare `md5(pg_get_functiondef)` em produção com o corpo que está no rollback das duas migrations (cmp do roteiro t_73d723f7/mk.py).
3. **Backup:** `bash /root/.config/max/adm-max-prod-pg/backup-prod.sh locacao-329-330` (antes do ensaio, para não dar 55P03).
4. **Estado de antes:** impressão digital lida pelo endpoint de ESCRITA + md5 de `locacoes` (inclui a nº 12) e de `locacao_config` de cada org.
5. **Ensaio em produção, numa transação desfeita:** 120000 → 150000 → rollback 150000 → rollback 120000 → impressão digital igual à de antes → `ROLLBACK`. Use o roteiro de `supabase/tests/run-locacao-integracao.sh` sem as suítes.
6. **Aplicar:** 120000 + linha em `schema_migrations`, `COMMIT`; depois 150000 + linha, `COMMIT`. Releia as tabelas, as funções e a ACL (`acl.sql`: 42501 para anon).
7. **md5 depois:** `locacoes` e `locacao_config` têm de ficar iguais ao passo 4. A coluna nova `imovel_tipo` fica nula e a equipe só é gravada em locação nova.
8. **Frontend:** merge do PR de integração na main (fecha #329/#330 como incluídos), worktree `wt-release-captacao` limpo, `git pull --ff-only`, `npm run deploy:safe`. Anote a versão anterior do Worker.
9. **Smoke em produção (Conferência MAX, dados fictícios):** abrir locação comercial com seguro-fiança → Montar contrato Pottencial → assinatura sem apólice → chave travada → anexar apólice → chave liberada → lançamento → comissão; filtro por equipe na aba Comissão. Limpe no fim com `limpar.py` (sequence e arquivos do bucket).
10. **WhatsApp:** só depois do smoke e do "ok" do Denis, 1 envio real controlado para um número de teste. Confira em `locacao_avisos.status`.

## Reversão (se algo der errado)
1. Worker: `wrangler versions deploy <versão anterior>@100%`.
2. Banco: `supabase/rollback/20261201150000_locacao_reuniao_16_11.sql` + `DELETE schema_migrations` da 150000.
3. Banco: `supabase/rollback/20261201120000_locacao_modelos_contrato.sql` + `DELETE schema_migrations` da 120000.
4. Arquivos de apólice no bucket `locacao-documentos/<org>/<loc>/anexos/` não saem por SQL. Apague pela API do Storage se for preciso.
5. Os dados digitados depois da publicação nas tabelas novas (lançamentos, anexos, avisos, versões de modelo) se perdem no rollback: exporte antes.

## Evidência da homologação (t_6feb2df6)
- SQL integrado: 59/59 modelos + 59/59 reunião, com as duas migrations aplicadas juntas; o rollback na ordem inversa dá a impressão digital igual.
- Vitest: 4169 passaram, 146 pulados. Build ok. tsc: os mesmos 13 erros antigos da main, nenhum novo.
- Ensaio de tela ponta a ponta (computador e celular) e homologação revertida com a impressão digital igual à de antes.
