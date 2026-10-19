// Pré-carregado no servidor local (NODE_OPTIONS=--import) só para o print: a chamada à IA não sai da
// máquina. Responde como o Gemini responderia a um comprovante FICTÍCIO; qualquer outra URL segue normal.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = body.contents?.[0]?.parts?.[0]?.text ?? "";
    console.log("[gemini-stub] prompt de comprovante do titular:", prompt.includes("endereço do titular"));
    const values = {
      endereco_completo: "Rua das Acácias Fictícias, 321, apto 12, Jardim Exemplo, Sorocaba/SP, 18000-000",
      nome_completo: "Titular Da Conta Fictícia",
    };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(values) }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
};
