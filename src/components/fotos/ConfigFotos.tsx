import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fotosDb } from "@/lib/vouchers-fotos-module";
import { mensagemErroFoto, type ResumoFotos } from "@/lib/vouchers-fotos";

const NENHUM = "__nenhum__";

/** Configurações do módulo (admin): o fotógrafo (staff) e o valor por sessão. */
export function ConfigFotos({ resumo, onSalvo }: { resumo: ResumoFotos; onSalvo: () => void }) {
  const [staff, setStaff] = useState<{ id: string; nome: string }[] | null>(null);
  const [fotografo, setFotografo] = useState(resumo.fotografo_id ?? NENHUM);
  const [valor, setValor] = useState(String(resumo.valor_sessao ?? 0));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void fotosDb.rpc("photo_staff_listar").then(({ data, error }) => {
      if (error) toast.error(mensagemErroFoto(error, "Não foi possível carregar a equipe staff."));
      setStaff((data as { id: string; nome: string }[] | null) ?? []);
    });
  }, []);

  const salvar = async () => {
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100000) return toast.error("Valor por sessão inválido.");
    setSalvando(true);
    const { error } = await fotosDb.rpc("photo_configurar", {
      _fotografo: fotografo === NENHUM ? null : fotografo,
      _valor: v,
    });
    setSalvando(false);
    if (error) return toast.error(mensagemErroFoto(error, "Não foi possível salvar."));
    toast.success("Configurações salvas.");
    onSalvo();
  };

  return (
    <Card className="max-w-xl" data-testid="config-fotos">
      <CardHeader>
        <CardTitle className="text-base">Configurações do Agendar fotos</CardTitle>
        <p className="text-sm text-muted-foreground">
          Um fotógrafo por imobiliária (usuário staff). O valor vale para as próximas sessões e fica
          congelado quando a sessão é marcada como feita.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Fotógrafo</span>
          <Select value={fotografo} onValueChange={setFotografo} disabled={!staff}>
            <SelectTrigger aria-label="Fotógrafo">
              <SelectValue placeholder="Escolha um usuário staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Nenhum (agenda fechada)</SelectItem>
              {(staff ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {staff && staff.length === 0 && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Nenhum usuário staff ativo. Dê o papel “staff” ao fotógrafo em Usuários.
            </span>
          )}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Valor por sessão (R$)</span>
          <Input
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="w-40"
            aria-label="Valor por sessão"
          />
        </label>
        <Button onClick={() => void salvar()} disabled={salvando}>
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}
