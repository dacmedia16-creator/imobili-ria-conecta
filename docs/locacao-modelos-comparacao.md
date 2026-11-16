# Comparação dos 8 contratos enviados por Denis (t_d08cfeee) — sem dados de clientes

## 1. FIADOR enviado × texto atual do sistema (src/lib/locacao-clausulas.json, 87 parágrafos)
- O corpo das cláusulas é **o mesmo**. A única diferença de texto é um espaço antes da vírgula no parágrafo do reajuste IPCA.
- O que o sistema **não** tinha:
  1. **"Cláusula 29º – isenção da multa após o 12º mês" + "Parágrafo primeiro"**. Essa é uma condição negociada (existe no FIADOR, na CAUÇÃO e na POTTENCIAL, mas não nos outros). No modelo novo ela virou cláusula condicional, que só entra quando a montagem pede a isenção (campo "Isenção da multa rescisória (meses)").
  2. Cabeçalho completo da ADMINISTRADORA, com o parágrafo sobre a administração até a entrega das chaves (o sistema só tinha nome/CNPJ/CRECI).
  3. "QUADRO RESUMO" e "PRÊAMBULO" com o texto inteiro.
- Os dados variáveis (partes, imóvel, prazo, aluguel, moradores, assinaturas) já eram campos e continuam sendo.

## 2. Núcleo comum e o que é próprio de cada garantia
Os 8 contratos têm o **mesmo esqueleto**: cabeçalho → (quadro resumo) → preâmbulo → partes → ADMINISTRADORA → **bloco da GARANTIA** → objeto → destinação → prazo → cláusulas 1–2 (aluguel) → cláusulas adicionais → corpo (encargos, reajuste, contas, vistoria, benfeitorias, rescisão, seguro incêndio, LGPD, disposições gerais) → assinaturas.

Texto-base do corpo (medido parágrafo a parágrafo):
- **Núcleo A (revisado, IPCA)**: FIADOR, CAUÇÃO, POTTENCIAL, CREDPAGO. O corpo é praticamente idêntico; muda só o bloco da garantia.
- **Núcleo B (versão antiga)**: TOKIO MARINE e ALMADA (IPCA), e PORTO SEGURO, que ainda usa **IGP-M** e redação anterior em várias cláusulas (multa por atraso, vistoria, seguro incêndio). ⚠️ Vale perguntar à Larissa se a Porto deve passar para o núcleo A.
- **Núcleo C (comercial, parte revisado)**: CAUCIONAMENTO. É o núcleo B com cláusulas reescritas (mora, foro, benfeitorias, administração, seguro em condomínio).

Blocos próprios:
- Fiador: 8 parágrafos de fiança + imóvel do fiador (matrícula/cartório).
- Caução em dinheiro: valor, nº de aluguéis, forma de depósito, favorecido; devolução corrigida pela poupança.
- Caucionamento (comercial): caucionante, imóvel caucionado (descrição/matrícula/cartório), averbação por conta do caucionante.
- Porto (22 parágrafos), Pottencial (12), Tokio (4), Almada (1), Loft (14): texto da seguradora/Loft, **travado** (sem troca de gênero, editável só com confirmação), + linha da apólice/anexo.
- Residencial × comercial: muda só o **bloco de destinação** (MORADIA/HABITAÇÃO × COMERCIAL). Cada modelo leva as duas versões.

**"Quadro resumo" × "Preâmbulo"**: não são estruturas diferentes. Todos têm PRÊAMBULO, e o "Quadro resumo" é só uma linha de índice que alguns trazem. **Basta um formato só**, com a linha do quadro resumo opcional (fica no modelo de quem já a tinha).

## 3. Comercial com outras garantias
Dá para reaproveitar o residencial trocando o bloco de destinação. Isso já está pronto: cada modelo tem a versão comercial. ⚠️ Recomendo que a Larissa ou um jurídico confira antes de usar, porque o comercial real (caucionamento) também mudou a redação de mora, foro e benfeitorias.

## 4. O que ainda falta
- Título de capitalização: sem modelo (segue com a minuta anexada).
- Comercial com fiador, seguro ou caução em dinheiro: só por adaptação (item 3), sem modelo comercial real.
- Seguradoras sem texto: Liberty, Too Seguros, CredPago "seguro" (não Loft), Mapfre, SulAmérica e Porto "Aluguel Essencial", se forem usadas. A Porto enviada usa o núcleo antigo.
