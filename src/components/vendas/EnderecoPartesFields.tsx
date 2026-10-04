import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/vendas/shared";
import { buscarCep, formatarCep, normalizarCep } from "@/lib/endereco-imovel";

type Partes = {
  imovel_cep?: string | null;
  imovel_logradouro?: string | null;
  imovel_numero?: string | null;
  imovel_complemento?: string | null;
  imovel_bairro?: string | null;
  imovel_cidade?: string | null;
  imovel_uf?: string | null;
};

/**
 * Endereço do imóvel em partes (para relatório por bairro/cidade). O "Endereço do imóvel"
 * completo continua sendo o campo livre logo acima. Digitar o CEP completa rua, bairro,
 * cidade e UF (ViaCEP); número e complemento ficam com o corretor.
 */
export function EnderecoPartesFields({
  value,
  disabled,
  onChange,
  faltando = [],
}: {
  value: Partes;
  disabled: boolean;
  onChange: (patch: Partes) => void;
  /** Colunas obrigatórias ainda vazias, para marcar em vermelho (após tentar enviar). */
  faltando?: string[];
}) {
  const vazio = (k: keyof Partes) => faltando.includes(k) && !(value[k] ?? "").toString().trim();
  const erro = (k: keyof Partes) =>
    vazio(k) ? { invalid: true, errorText: "Obrigatório para enviar ao gestor" } : {};
  const [buscando, setBuscando] = useState(false);
  const [cepAviso, setCepAviso] = useState<string | null>(null);

  const aoSairDoCep = async () => {
    const cep = normalizarCep(value.imovel_cep);
    setCepAviso(null);
    if (!cep) {
      if (value.imovel_cep) setCepAviso("CEP precisa ter 8 números.");
      return;
    }
    setBuscando(true);
    const via = await buscarCep(cep);
    setBuscando(false);
    if (!via) {
      setCepAviso("CEP não encontrado. Preencha rua, bairro e cidade à mão.");
      return;
    }
    onChange({
      imovel_cep: cep,
      imovel_logradouro: via.logradouro ?? value.imovel_logradouro ?? null,
      imovel_bairro: via.bairro ?? value.imovel_bairro ?? null,
      imovel_cidade: via.cidade ?? value.imovel_cidade ?? null,
      imovel_uf: via.uf ?? value.imovel_uf ?? null,
    });
  };

  const campo = (k: keyof Partes) => ({
    value: value[k] ?? "",
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ [k]: e.target.value || null } as Partes),
  });

  return (
    <>
      <div
        id="endereco-imovel-partes"
        className="md:col-span-2 -mb-2 text-xs font-medium text-muted-foreground"
      >
        Endereço separado (obrigatório para enviar ao gestor: rua, número, bairro, cidade e UF)
      </div>
      <Field
        label="CEP do imóvel"
        hint="Ao digitar o CEP, rua, bairro e cidade são preenchidos automaticamente."
        errorText={cepAviso ?? undefined}
        invalid={!!cepAviso}
      >
        <div className="relative">
          <Input
            inputMode="numeric"
            placeholder="00000-000"
            value={formatarCep(value.imovel_cep)}
            disabled={disabled}
            onChange={(e) =>
              onChange({ imovel_cep: e.target.value.replace(/\D/g, "").slice(0, 8) || null })
            }
            onBlur={aoSairDoCep}
          />
          {buscando && (
            <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </Field>
      <Field label="Rua / avenida" {...erro("imovel_logradouro")}>
        <Input {...campo("imovel_logradouro")} />
      </Field>
      <Field
        label="Número"
        hint="Sem número (terreno, chácara)? Escreva S/N."
        {...erro("imovel_numero")}
      >
        <Input {...campo("imovel_numero")} />
      </Field>
      <Field label="Complemento">
        <Input placeholder="Apto, bloco, casa, unidade" {...campo("imovel_complemento")} />
      </Field>
      <Field label="Bairro" {...erro("imovel_bairro")}>
        <Input {...campo("imovel_bairro")} />
      </Field>
      <Field
        label="Cidade / UF"
        {...(vazio("imovel_cidade") || vazio("imovel_uf")
          ? { invalid: true, errorText: "Cidade e UF são obrigatórias para enviar ao gestor" }
          : {})}
      >
        <div className="flex gap-2">
          <Input className="flex-1" {...campo("imovel_cidade")} />
          <Input
            className="w-16"
            maxLength={2}
            placeholder="UF"
            value={value.imovel_uf ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ imovel_uf: e.target.value.toUpperCase() || null })}
          />
        </div>
      </Field>
    </>
  );
}
