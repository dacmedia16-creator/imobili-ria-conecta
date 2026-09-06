# Deploy Seguro ADM MAX

Toda publicação em produção deve partir exclusivamente da raiz deste repositório e usar:

```bash
npm run deploy:safe
```

Para validar sem publicar:

```bash
npm run deploy:check
```

O processo faz uma única instalação reproduzível, executa os testes, gera o build uma vez e publica exatamente o artefato aprovado, sem recompilar.

O processo bloqueia a publicação quando:

- o projeto está em `/tmp` ou não corresponde ao repositório oficial;
- a branch não é `main`;
- existem mudanças locais sem commit;
- o código local não é exatamente o mesmo commit de `origin/main`;
- testes, build ou verificações críticas falham.

Depois do deploy, as páginas pública inicial e de especialistas são verificadas. Se a validação falhar e a versão anterior puder ser identificada, o Worker é revertido automaticamente.

Não use `npm run deploy`, `npm run deploy:prebuilt`, `nitro deploy` ou `wrangler deploy` diretamente em produção. O comando `deploy:prebuilt` é interno do fluxo seguro e pressupõe que os gates anteriores já passaram.
