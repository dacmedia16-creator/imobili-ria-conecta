import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nomeCompletoValido, normalizarCpf, telefoneValido } from "@/lib/completar-perfil";
import {
  cadastroDaSituacao,
  pendenciasCadastro,
  remaxIdValido,
  type CadastroForm,
  type SituacaoFicha,
} from "@/lib/ficha-colaborador";
import { salvarMeuCadastro } from "@/lib/ficha-colaborador-db";

/**
 * Cadastro pendente no mesmo aviso/trava da ficha (t_b98f3e4b). Mostra só os campos que faltam ou
 * estão errados: nome, telefone e — para corretor/gestor/team leader — CPF e ID RE/MAX. CRECI não é
 * cobrado. A tela orienta; quem decide e valida é o banco (cadastro_salvar_meu).
 */
export function CadastroPendenteForm({
  situacao,
  onSalvo,
  rodape,
}: {
  situacao: SituacaoFicha | null;
  onSalvo: (nova: SituacaoFicha) => void;
  rodape?: (salvando: boolean) => ReactNode;
}) {
  const pend = pendenciasCadastro(situacao);
  const [c, setC] = useState<CadastroForm>(() => cadastroDaSituacao(situacao));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof CadastroForm, v: string) => setC((x) => ({ ...x, [k]: v }));

  const pedeNome = pend.includes("nome");
  const pedeTel = pend.includes("telefone");
  const pedeCpf = pend.includes("cpf");
  const pedeId = pend.some((p) => p.startsWith("remax_id"));

  const erros: string[] = [];
  if (pedeNome && !nomeCompletoValido(c.nome)) erros.push("nome");
  if (pedeTel && !telefoneValido(c.telefone)) erros.push("telefone");
  if (pedeCpf && !normalizarCpf(c.cpf)) erros.push("cpf");
  if (pedeId && !remaxIdValido(c.remax_id)) erros.push("remax_id");
  const erro = (k: string) => tentou && erros.includes(k);

  const avisoId = pend.includes("remax_id_duplicado")
    ? "O ID RE/MAX do seu cadastro está repetido em outra pessoa. Confira e corrija."
    : pend.includes("remax_id_invalido")
      ? "O ID RE/MAX do seu cadastro está fora do padrão. Corrija para 9 números começando com 630."
      : "Seu código de corretor na RE/MAX: 9 números começando com 630 (ex.: 630601272).";

  const salvar = async () => {
    setTentou(true);
    if (erros.length) {
      toast.error("Confira os campos destacados.");
      return;
    }
    setSalvando(true);
    try {
      const nova = await salvarMeuCadastro({
        nome: pedeNome ? c.nome : "",
        telefone: pedeTel ? c.telefone : "",
        cpf: pedeCpf ? c.cpf : "",
        remax_id: pedeId ? c.remax_id : "",
      });
      toast.success("Cadastro atualizado.");
      onSalvo(nova);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="cadastro-form">
      {pedeNome && (
        <Campo id="cad-nome" label="Nome completo" erro={erro("nome")} dica="Nome e sobrenome.">
          <Input
            id="cad-nome"
            autoComplete="name"
            maxLength={160}
            value={c.nome}
            onChange={(e) => set("nome", e.target.value)}
          />
        </Campo>
      )}
      {pedeTel && (
        <Campo id="cad-tel" label="Telefone (WhatsApp)" erro={erro("telefone")}>
          <Input
            id="cad-tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(15) 99123-4567"
            maxLength={20}
            value={c.telefone}
            onChange={(e) => set("telefone", e.target.value)}
          />
        </Campo>
      )}
      {pedeCpf && (
        <Campo id="cad-cpf" label="CPF" erro={erro("cpf")}>
          <Input
            id="cad-cpf"
            inputMode="numeric"
            placeholder="000.000.000-00"
            maxLength={14}
            value={c.cpf}
            onChange={(e) => set("cpf", e.target.value)}
          />
        </Campo>
      )}
      {pedeId && (
        <Campo id="cad-remax" label="ID RE/MAX" erro={erro("remax_id")} dica={avisoId}>
          <Input
            id="cad-remax"
            inputMode="numeric"
            placeholder="630601272"
            maxLength={9}
            value={c.remax_id}
            onChange={(e) => set("remax_id", e.target.value.replace(/\D/g, "").slice(0, 9))}
          />
        </Campo>
      )}
      <Button
        className="h-11 w-full text-base"
        onClick={salvar}
        disabled={salvando}
        data-testid="cadastro-salvar"
      >
        {salvando ? "Salvando…" : "Salvar cadastro"}
      </Button>
      {rodape?.(salvando)}
    </div>
  );
}

function Campo({
  id,
  label,
  erro,
  dica,
  children,
}: {
  id: string;
  label: string;
  erro?: boolean;
  dica?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={erro ? "text-destructive" : undefined}>
        {label}
        {erro ? " — confira" : ""}
      </Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}
