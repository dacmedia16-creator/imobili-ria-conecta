import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DATA_NASCIMENTO_MIN,
  dataNascimentoMaxima,
  erroCampoDataNascimento,
} from "@/lib/data-nascimento";
import {
  AVISO_FINALIDADE,
  CAMPO_FICHA_LABEL,
  RELIGIOES,
  camposFichaFaltando,
  formDaSituacao,
  type CampoFicha,
  type FichaForm,
  type SituacaoFicha,
} from "@/lib/ficha-colaborador";
import { salvarMinhaFicha } from "@/lib/ficha-colaborador-db";

const validarNascimento = (d: string) => erroCampoDataNascimento(d, true);

/**
 * Formulário da ficha pessoal e de emergência (t_618b64bc). Usado no porteiro do login e no
 * "Meu acesso". Valida aqui para orientar a pessoa; o banco valida de novo ao salvar.
 */
export function FichaColaboradorForm({
  situacao,
  rotuloSalvar = "Salvar ficha",
  onSalvo,
  rodape,
}: {
  situacao: SituacaoFicha | null;
  rotuloSalvar?: string;
  onSalvo: (nova: SituacaoFicha) => void;
  /** Botões extras abaixo do "Salvar" (Preencher depois / Sair). */
  rodape?: (salvando: boolean) => ReactNode;
}) {
  const [f, setF] = useState<FichaForm>(() => formDaSituacao(situacao));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const faltando = camposFichaFaltando(f, validarNascimento);
  const erro = (c: CampoFicha) => tentou && faltando.includes(c);
  const set = <K extends keyof FichaForm>(k: K, v: FichaForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const religiaoOutra = f.religiao !== "" && !(RELIGIOES as readonly string[]).includes(f.religiao);
  const [religiaoModo, setReligiaoModo] = useState<string>(
    f.religiao === "" ? "" : religiaoOutra ? "__outra__" : f.religiao,
  );

  const salvar = async () => {
    setTentou(true);
    if (faltando.length) {
      toast.error(`Falta preencher: ${faltando.map((c) => CAMPO_FICHA_LABEL[c]).join(", ")}.`);
      return;
    }
    setSalvando(true);
    try {
      const nova = await salvarMinhaFicha(f);
      toast.success("Ficha salva. Obrigado!");
      onSalvo(nova);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  const erroNasc = tentou ? validarNascimento(f.data_nascimento) : null;

  return (
    <div className="space-y-5" data-testid="ficha-form">
      <div
        className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
        data-testid="ficha-aviso"
      >
        {AVISO_FINALIDADE}
      </div>

      <Secao titulo="Sobre você">
        <Campo
          id="fc-nasc"
          label="Data de nascimento"
          erro={erro("data_nascimento")}
          dica={erroNasc ?? undefined}
        >
          <Input
            id="fc-nasc"
            type="date"
            autoComplete="bday"
            min={DATA_NASCIMENTO_MIN}
            max={dataNascimentoMaxima()}
            value={f.data_nascimento}
            onChange={(e) => set("data_nascimento", e.target.value)}
          />
        </Campo>
        <Campo
          id="fc-filhos"
          label="Quantidade de filhos"
          erro={erro("qtd_filhos")}
          dica="Use 0 se não tiver."
        >
          <Input
            id="fc-filhos"
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            value={f.qtd_filhos}
            onChange={(e) => set("qtd_filhos", e.target.value.replace(/\D/g, "").slice(0, 2))}
          />
        </Campo>
      </Secao>

      <Secao titulo="Saúde">
        <Campo id="fc-plano-sim" label="Tem plano de saúde?" erro={erro("tem_plano_saude")}>
          <div className="flex gap-2" role="radiogroup" aria-label="Tem plano de saúde?">
            {(["sim", "nao"] as const).map((v) => (
              <Button
                key={v}
                id={v === "sim" ? "fc-plano-sim" : undefined}
                type="button"
                role="radio"
                aria-checked={f.tem_plano_saude === v}
                variant={f.tem_plano_saude === v ? "default" : "outline"}
                className="flex-1"
                onClick={() => set("tem_plano_saude", v)}
              >
                {v === "sim" ? "Sim" : "Não"}
              </Button>
            ))}
          </div>
        </Campo>
        {f.tem_plano_saude === "sim" && (
          <Campo id="fc-plano" label="Qual plano de saúde?" erro={erro("plano_saude")}>
            <Input
              id="fc-plano"
              placeholder="Ex.: Unimed, Bradesco Saúde"
              maxLength={120}
              value={f.plano_saude}
              onChange={(e) => set("plano_saude", e.target.value)}
            />
          </Campo>
        )}
        <Campo
          id="fc-hospital"
          label="Hospital de preferência para levar você"
          erro={erro("hospital_preferencia")}
        >
          <Input
            id="fc-hospital"
            placeholder="Nome do hospital e cidade"
            maxLength={160}
            value={f.hospital_preferencia}
            onChange={(e) => set("hospital_preferencia", e.target.value)}
          />
        </Campo>
      </Secao>

      <Secao titulo="Contato de emergência">
        <Campo id="fc-en" label="Nome" erro={erro("emergencia_nome")}>
          <Input
            id="fc-en"
            maxLength={120}
            value={f.emergencia_nome}
            onChange={(e) => set("emergencia_nome", e.target.value)}
          />
        </Campo>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo id="fc-ep" label="Parentesco" erro={erro("emergencia_parentesco")}>
            <Input
              id="fc-ep"
              placeholder="Ex.: Mãe, esposo(a)"
              maxLength={60}
              value={f.emergencia_parentesco}
              onChange={(e) => set("emergencia_parentesco", e.target.value)}
            />
          </Campo>
          <Campo id="fc-et" label="Telefone (com DDD)" erro={erro("emergencia_telefone")}>
            <Input
              id="fc-et"
              type="tel"
              inputMode="tel"
              placeholder="(15) 99123-4567"
              maxLength={20}
              value={f.emergencia_telefone}
              onChange={(e) => set("emergencia_telefone", e.target.value)}
            />
          </Campo>
        </div>
      </Secao>

      <Secao titulo="Religião (opcional)">
        <Campo id="fc-rel" label="Religião" dica="Opcional. Só para conhecimento da empresa.">
          <select
            id="fc-rel"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={religiaoModo}
            onChange={(e) => {
              const v = e.target.value;
              setReligiaoModo(v);
              set("religiao", v === "__outra__" ? "" : v);
            }}
          >
            <option value="">Não informar</option>
            {RELIGIOES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="__outra__">Outra</option>
          </select>
        </Campo>
        {religiaoModo === "__outra__" && (
          <Campo id="fc-rel-outra" label="Qual?" erro={erro("religiao")}>
            <Input
              id="fc-rel-outra"
              maxLength={60}
              value={f.religiao}
              onChange={(e) => set("religiao", e.target.value)}
            />
          </Campo>
        )}
      </Secao>

      <label
        className={`flex items-start gap-2 text-sm ${erro("ciente") ? "text-destructive" : ""}`}
        htmlFor="fc-ciente"
      >
        <Checkbox
          id="fc-ciente"
          checked={f.ciente}
          onCheckedChange={(v) => set("ciente", v === true)}
          className="mt-0.5"
        />
        <span>Li o aviso acima e concordo com o uso dos meus dados para essas finalidades.</span>
      </label>

      <Button
        className="h-11 w-full text-base"
        onClick={salvar}
        disabled={salvando}
        data-testid="ficha-salvar"
      >
        {salvando ? "Salvando…" : rotuloSalvar}
      </Button>
      {rodape?.(salvando)}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-semibold">{titulo}</legend>
      {children}
    </fieldset>
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
        {erro ? " — obrigatório" : ""}
      </Label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}
