function dataLocal(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function periodoMesAtual(agora = new Date()) {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  return {
    de: dataLocal(new Date(ano, mes, 1)),
    ate: dataLocal(new Date(ano, mes + 1, 0)),
  };
}

export function periodoInicialVendas(agora = new Date()) {
  return periodoMesAtual(agora);
}

export function periodoMesAnterior(agora = new Date()) {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  return {
    de: dataLocal(new Date(ano, mes - 1, 1)),
    ate: dataLocal(new Date(ano, mes, 0)),
  };
}
