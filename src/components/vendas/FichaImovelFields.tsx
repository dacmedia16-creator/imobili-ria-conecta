import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/vendas/shared";
import {
  TIPOS_IMOVEL,
  areaM2DoTexto,
  campoVisivel,
  fichaFaltando,
  formatarArea,
  inteiroDoTexto,
  anoConstrucaoDoTexto,
  isResidencial,
  type FichaVenda,
  type SugestaoAreas,
} from "@/lib/ficha-imovel";

/** Patch da ficha (colunas de public.sales). area_confirmada_por é sempre gravado pelo banco. */
export type FichaPatch = Partial<
  Pick<
    FichaVenda,
    | "tipo_imovel"
    | "area_util_m2"
    | "area_construida_m2"
    | "area_terreno_m2"
    | "ano_construcao"
    | "quartos"
    | "suites"
    | "banheiros"
    | "vagas"
    | "area_origem"
    | "area_confirmada_em"
  >
>;

const DESCONFIRMA: FichaPatch = { area_confirmada_em: null };

/**
 * Bloco "Ficha do imóvel" da venda: os mesmos campos e a mesma lista de tipos do Estudo de Mercado.
 * A área útil pode vir como sugestão dos documentos já lidos; o corretor confirma antes de enviar ao
 * gestor (o banco grava quem e quando). Mudar área ou tipo desfaz a confirmação.
 */
export function FichaImovelFields({
  value,
  disabled,
  onChange,
  sugestao,
  mostrarErros,
  confirmadaPorNome,
}: {
  value: FichaVenda;
  disabled: boolean;
  onChange: (patch: FichaPatch) => void;
  sugestao: SugestaoAreas | null;
  mostrarErros: boolean;
  confirmadaPorNome?: string | null;
}) {
  const tipo = value.tipo_imovel ?? null;
  const falta = fichaFaltando(value);
  const erro = (rotulo: string) =>
    mostrarErros && falta.includes(rotulo)
      ? { invalid: true, errorText: "Obrigatório para enviar ao gestor" }
      : {};
  const areaChave = tipo === "Terreno" ? "area_terreno_m2" : "area_util_m2";
  const areaAtual = value[areaChave];
  const confirmada = !!value.area_confirmada_em;
  const sugestaoArea =
    tipo === "Terreno" ? (sugestao?.area_terreno_m2 ?? null) : (sugestao?.area_util_m2 ?? null);
  const sugestaoFonte =
    tipo === "Terreno" ? "área total da matrícula/IPTU" : (sugestao?.area_util_fonte ?? null);

  const area = (k: "area_util_m2" | "area_construida_m2" | "area_terreno_m2", label: string) =>
    campoVisivel(k, tipo) && (
      <Field
        key={k}
        label={label}
        required={k === areaChave}
        {...(k === areaChave ? erro(tipo === "Terreno" ? "Área do terreno" : "Área útil") : {})}
      >
        <Input
          inputMode="decimal"
          placeholder="Ex: 110"
          value={value[k] ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const n = areaM2DoTexto(e.target.value);
            onChange({
              [k]: e.target.value.trim() === "" ? null : (n ?? value[k] ?? null),
              ...(k === areaChave ? { ...DESCONFIRMA, area_origem: "corretor" } : {}),
            });
          }}
        />
      </Field>
    );

  const contagem = (k: "quartos" | "suites" | "banheiros" | "vagas", label: string, obrig: boolean) =>
    campoVisivel(k, tipo) && (
      <Field key={k} label={label} required={obrig} {...(obrig ? erro(label) : {})}>
        <Input
          type="number"
          min="0"
          max="99"
          step="1"
          value={value[k] ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ [k]: inteiroDoTexto(e.target.value) })}
        />
      </Field>
    );

  const residencial = isResidencial(tipo);

  return (
    <>
      <div
        id="ficha-imovel"
        className="md:col-span-2 -mb-2 mt-2 text-xs font-medium text-muted-foreground"
      >
        Ficha do imóvel (mesmos campos do Estudo de Mercado; obrigatória para enviar ao gestor)
      </div>
      <Field label="Tipo do imóvel" required {...erro("Tipo do imóvel")}>
        <Select
          value={tipo ?? "none"}
          disabled={disabled}
          onValueChange={(v) =>
            onChange({ tipo_imovel: v === "none" ? null : v, ...DESCONFIRMA })
          }
        >
          <SelectTrigger aria-label="Tipo do imóvel">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Selecione</SelectItem>
            {TIPOS_IMOVEL.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {area("area_util_m2", "Área útil (m²)")}
      {area("area_terreno_m2", "Área do terreno (m²)")}
      {area("area_construida_m2", "Área construída (m²)")}
      {tipo !== "Terreno" && (
        <Field label="Ano de construção">
          <Input
            type="number"
            min="1800"
            step="1"
            placeholder="Ex: 2015"
            value={value.ano_construcao ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ano_construcao: anoConstrucaoDoTexto(e.target.value) ?? null })
            }
          />
        </Field>
      )}
      {contagem("quartos", "Quartos", residencial)}
      {contagem("suites", "Suítes", false)}
      {contagem("banheiros", "Banheiros", residencial)}
      {contagem("vagas", "Vagas", residencial)}

      {tipo && (
        <div className="md:col-span-2 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          {sugestaoArea != null && Number(areaAtual) !== sugestaoArea && (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Sugestão dos documentos: <strong>{formatarArea(sugestaoArea)}</strong>
                {sugestaoFonte ? ` (${sugestaoFonte})` : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onChange({ [areaChave]: sugestaoArea, area_origem: "documento", ...DESCONFIRMA })
                }
              >
                Usar sugestão
              </Button>
            </div>
          )}
          {sugestao?.divergente && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Matrícula ({formatarArea(sugestao.matricula_construida_m2)}) e IPTU (
              {formatarArea(sugestao.iptu_construida_m2)}) trazem área construída diferente. Confira
              antes de confirmar.
            </p>
          )}
          {tipo !== "Terreno" && tipo !== "Casa" && tipo !== "Comercial" && (
            <p className="text-xs text-muted-foreground">
              Apartamento, cobertura e studio: use a área PRIVATIVA da matrícula. A “área do terreno”
              do IPTU é fração ideal e não vale aqui.
            </p>
          )}
          {confirmada ? (
            <p className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {tipo === "Terreno" ? "Área do terreno" : "Área útil"} confirmada
              {confirmadaPorNome ? ` por ${confirmadaPorNome}` : ""}
              {value.area_confirmada_em
                ? ` em ${new Date(value.area_confirmada_em).toLocaleDateString("pt-BR")}`
                : ""}
              .
            </p>
          ) : (
            <div
              className={`flex flex-wrap items-center gap-2 ${mostrarErros && falta.some((f) => f.startsWith("Confirmar")) ? "text-destructive" : ""}`}
            >
              <span>
                {Number(areaAtual) > 0
                  ? `Confira e confirme a ${tipo === "Terreno" ? "área do terreno" : "área útil"}: ${formatarArea(areaAtual)}.`
                  : `Informe a ${tipo === "Terreno" ? "área do terreno" : "área útil"} para confirmar.`}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={disabled || !(Number(areaAtual) > 0)}
                onClick={() => onChange({ area_confirmada_em: new Date().toISOString() })}
              >
                Confirmar {tipo === "Terreno" ? "área do terreno" : "área útil"}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
