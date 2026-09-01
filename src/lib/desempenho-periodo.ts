import { mesAtualRange } from "@/lib/producao-por-pessoa-filters";

export type IntervaloDesempenho = { de: string; ate: string };

export const intervaloInicialDesempenho = (): IntervaloDesempenho => mesAtualRange();

export const intervaloValido = ({ de, ate }: IntervaloDesempenho) =>
  Boolean(de && ate && de <= ate);

const dataLocal = (iso: string) => {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
};

export function periodoDesempenhoLabel({ de, ate }: IntervaloDesempenho): string {
  if (!intervaloValido({ de, ate })) return "período inválido";

  const inicio = dataLocal(de);
  const fim = dataLocal(ate);
  const mesmoMes =
    inicio.getFullYear() === fim.getFullYear() && inicio.getMonth() === fim.getMonth();
  const ultimoDia = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0).getDate();

  if (mesmoMes && inicio.getDate() === 1 && fim.getDate() === ultimoDia) {
    return inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }

  const formatar = (data: Date) => data.toLocaleDateString("pt-BR");
  return `${formatar(inicio)} a ${formatar(fim)}`;
}
