# Estudo de Mercado — vendas reais (somente leitura)

Entrega ao Estudo de Mercado MAX as vendas **assinadas** dos **últimos 12 meses** da imobiliária dona da
chave, para comparar "Anunciado R$/m² × Vendido R$/m²". Pedido de Denis em 11/10/2026 (t_3a52d15a).

## O que sai / o que nunca sai

- Sai: tipo, área (útil; Terreno = área do terreno), valor de venda, R$/m², mês da assinatura (AAAA-MM),
  rua **sem número**, bairro, cidade, UF, quartos, suítes, banheiros, vagas.
- Nunca sai: comprador, vendedor, corretor, comissão, documentos, código/ID da venda ou do imóvel,
  número, complemento, CEP, data exata, coordenadas.
- Rua: `estudo_rua_sem_numero` corta número, apto, bloco, lote, quadra, CEP e S/N; se o número da casa
  ainda aparecer, a rua não é enviada (fica só bairro/cidade).
- Venda sem área: aparece sem R$/m² e fica fora do cálculo de R$/m².

## Multiempresa

Uma chave por imobiliária. No banco fica só o SHA-256 (`estudo_vendas_api_keys`); a organização vem da
chave, nunca do pedido. Chave revogada ou imobiliária inativa -> 401.

## Requisição

`POST /functions/v1/estudo-vendas-reais` com header `x-estudo-vendas-key: <chave>` e corpo opcional:

```json
{
  "cidade": "Sorocaba",
  "uf": "SP",
  "bairros": ["Campolim"],
  "tipo": "Apartamento",
  "area_min": 60,
  "area_max": 100
}
```

## Implantação (cada passo depende de aprovação de Denis)

1. Aplicar a migration `20261011100000_estudo_vendas_reais.sql` (teste: `supabase/tests/run-estudo-vendas-reais.sh`).
2. Publicar a função com `verify_jwt = false` (a chave é validada pela própria função).
3. Gerar uma chave aleatória (>= 32 caracteres) por imobiliária, gravar só o hash:
   `INSERT INTO public.estudo_vendas_api_keys (organization_id, key_hash, label) VALUES ('<org>', encode(extensions.digest('<chave>', 'sha256'), 'hex'), 'Estudo de Mercado');`
4. Guardar a chave só no Worker do Estudo de Mercado (secret `ADM_VENDAS_REAIS_KEY`) — nunca no repositório.
5. Revogar: `UPDATE public.estudo_vendas_api_keys SET revoked_at = now() WHERE id = '<id>';`
