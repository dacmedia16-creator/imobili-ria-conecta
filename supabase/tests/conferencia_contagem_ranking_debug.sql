SELECT 'DBG ' || a.u || ' vendas ' || (a.v ->> 'minhas_vendas') || '->' || (d.v ->> 'minhas_vendas')
  || ' assin ' || (a.v ->> 'meus_assinados') || '->' || (d.v ->> 'meus_assinados')
FROM antes a JOIN depois d ON d.k = a.k AND d.u = a.u WHERE a.k = 'dash';
