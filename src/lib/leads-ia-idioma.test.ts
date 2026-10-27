// t_f7155e0c: trava "idioma" — espanhol barrado, português (inclusive nomes reais de bairro/condomínio) passando.
import { describe, expect, it } from "vitest";
import { norm } from "./leads-ia";
import { RE_IDIOMA } from "./leads-ia-redacao";
import { NOMES_REAIS } from "./leads-ia-idioma.nomes.dados";
import { REFERENCIA } from "./leads-ia-referencia.dados";

/** Mesmo teste da validarRedacao: texto em minúsculas e texto normalizado (sem acento). */
const pega = (t: string) => RE_IDIOMA.test(t.toLowerCase()) || RE_IDIOMA.test(norm(t));
const qual = (t: string) => RE_IDIOMA.exec(norm(t))?.[0] ?? RE_IDIOMA.exec(t.toLowerCase())?.[0] ?? null;

describe("trava idioma: espanhol é barrado", () => {
  const ESPANHOL = [
    "La casa tiene 3 cuartos y el precio es R$ 655.000.", // o caso visto no DeepSeek (conversa B)
    "El precio: R$ 655.000. Quer agendar uma visita?",
    "O precio é R$ 655.000. Quer agendar?",
    "Claro! También tengo otra casa. Gostou?",
    "¿Quieres agendar una visita?",
    "¡Claro! Tenho outra casa.",
    "Tenho alguna opção no Campolim.",
    "Te gusta esa casa?",
    "Tiene 3 habitaciones y 2 baños.",
    "A casa tem 2 banos e cochera para 2 carros.",
    "Tem garaje para 2 carros e cocina americana.",
    "Puedo agendar para mañana?",
    "Quer visitarla no sábado?",
    "Podemos visitar el imóvel no sábado.",
    "Muy bonita, ubicada no Campolim.",
    "Hola, Denis! Gracias pelo contato.",
    "Tenho una casa no Jardim Piratininga.",
    "Casa con 3 quartos no Horto Florestal.",
    "A propiedad fica no barrio Campolim.",
    "São 114 metros cuadrados de área.",
    "No tengo ninguna otra opção nessa faixa.",
  ];
  for (const t of ESPANHOL) it(t, () => expect(pega(t)).toBe(true));
});

describe("trava idioma: português passa", () => {
  const PORTUGUES = [
    "O preço é R$ 655.000. Quer agendar uma visita?",
    "Também tenho outra casa no Horto Florestal. Gostou?",
    "Tem alguma opção com 3 suítes? Tenho alguma sim!",
    "A casa tem 2 banheiros e banho de sol no quintal.",
    "Cozinha americana, 3 quartos e garagem para 2 carros.",
    "Pode ser amanhã de manhã ou à tarde?",
    "Agora tenho uma casa no Campolim, muito bem localizada.",
    "Obrigada pelo contato! Quer conhecer pessoalmente?",
    "Fica perto da Avenida Antônio Carlos Comitre, com fácil acesso.",
    "Tenho uma casa com 3 quartos e 1 suíte, por R$ 870.000.",
    "Nenhuma outra casa nessa faixa tem 3 suítes.",
    "Quer visitar o imóvel no sábado?",
    "O condomínio é R$ 550 e o IPTU R$ 55 por mês.",
    "O corretor confirma isso com você na visita ou no contato.",
  ];
  for (const t of PORTUGUES) it(t, () => expect(qual(t)).toBeNull());

  it("falas das conversas de referência (1ª mensagem, cliente e esperado) não disparam", () => {
    const achados: string[] = [];
    for (const c of REFERENCIA) {
      for (const t of [c.primeira, ...c.falas.flatMap((f) => [f.cliente, f.esperado])])
        if (pega(t)) achados.push(`${c.id}: ${qual(t)} — ${t}`);
    }
    expect(achados).toEqual([]);
  });

  it(`nenhum dos ${NOMES_REAIS.length} bairros/condomínios reais dispara`, () => {
    expect(NOMES_REAIS.length).toBeGreaterThan(200);
    const achados = NOMES_REAIS.filter(pega).map((n) => `${qual(n)} — ${n}`);
    expect(achados).toEqual([]);
  });

  it("nome real dentro de uma frase normal também passa", () => {
    const achados = NOMES_REAIS.map((n) => `Tenho uma casa no ${n}, por R$ 650.000. Gostou?`).filter(pega);
    expect(achados).toEqual([]);
  });
});
