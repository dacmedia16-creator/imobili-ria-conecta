import { Handshake, Home, KeyRound } from "lucide-react";
import { InfoDot } from "@/components/dashboard/shared";
import { KpiTile } from "@/components/visual/base";
import type { TotaisProducao } from "@/lib/producao-por-pessoa-types";
import { formatQtd } from "./format";

export function TotalsCards({ totais }: { totais: TotaisProducao }) {
  // VGV e comissão ficam no Desempenho (Resumo da Operação). Aqui só a contagem de pontas.
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-1">
        <KpiTile
          destaque
          icon={Handshake}
          tom="blue"
          label="Vendas equivalentes"
          value={formatQtd(totais.qtdVendas)}
          info={
            <InfoDot text="Duas pontas (captou e vendeu) = 1 venda. Só captação ou só venda = 0,5. Parceria com outra imobiliária = 1 para a nossa ponta. Lançamento: 1 venda inteira para quem vendeu. Quem dividiu a ponta com outro corretor conta a ponta inteira; o total da empresa conta cada venda uma vez só." />
          }
        />
      </div>
      <KpiTile
        icon={Home}
        tom="violet"
        label="Pontas de captação"
        value={formatQtd(totais.qtdCaptacao)}
        info={<InfoDot text="Cada captação conta 0,5; se outra imobiliária vendeu, conta 1." />}
      />
      <KpiTile
        icon={KeyRound}
        tom="green"
        label="Pontas de venda"
        value={formatQtd(totais.qtdVenda)}
        info={
          <InfoDot text="Cada venda padrão conta 0,5; se outra imobiliária captou, conta 1. Lançamento conta a venda inteira para quem vendeu." />
        }
      />
    </div>
  );
}
