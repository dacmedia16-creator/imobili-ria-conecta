import { useEffect, useState } from "react";
import { MeusVouchers } from "@/components/fotos/MeusVouchers";
import { fotosDb, vouchersFotosEnabled } from "@/lib/vouchers-fotos-module";
import type { ResumoFotos } from "@/lib/vouchers-fotos";

/** Bloco de vouchers + barra "x de 3" na Minha carreira. Módulo desligado ou erro = não aparece. */
export function VouchersCarreira() {
  const [resumo, setResumo] = useState<ResumoFotos | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      if (!(await vouchersFotosEnabled())) return;
      const { data, error } = await fotosDb.rpc("photo_meu_resumo");
      if (vivo && !error && data) setResumo(data as ResumoFotos);
    })();
    return () => {
      vivo = false;
    };
  }, []);
  return resumo ? <MeusVouchers resumo={resumo} /> : null;
}
