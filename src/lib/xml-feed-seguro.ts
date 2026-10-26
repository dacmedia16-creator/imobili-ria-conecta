/**
 * Download SEGURO do "Link do XML (portais)" cadastrado na tela (card t_76243950).
 * O link é digitado por uma pessoa, então o servidor só baixa se:
 *  - for https, sem usuário/senha no endereço, porta 443 (ou nenhuma) e com NOME (não IP);
 *  - o nome não for interno (localhost, .local, .internal...);
 *  - TODOS os IPs do nome (DNS por HTTPS) forem públicos — nada de rede interna, loopback, link-local
 *    (ex.: 169.254.169.254, metadados de nuvem), CGNAT, multicast ou faixas reservadas;
 *  - cada redirecionamento (no máximo 3) passar pelas mesmas regras.
 * Falha de DNS = bloqueia (fecha por padrão). A mensagem de erro nunca leva o link.
 */

export type ResolverDns = (host: string) => Promise<string[]>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class LinkXmlInvalido extends Error {}

const HOST_INTERNO = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa|test|invalid|example)$/i;

/** Regras que não dependem de rede. Devolve a URL normalizada ou lança LinkXmlInvalido. */
export function validarLinkXml(raw: string): URL {
  const s = (raw ?? "").trim();
  if (!s || s.length > 500) throw new LinkXmlInvalido("Informe um link de até 500 caracteres.");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new LinkXmlInvalido("Link inválido.");
  }
  if (u.protocol !== "https:") throw new LinkXmlInvalido("Use um link https.");
  if (u.username || u.password) throw new LinkXmlInvalido("O link não pode ter usuário ou senha.");
  if (u.port && u.port !== "443") throw new LinkXmlInvalido("O link não pode usar outra porta.");
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || HOST_INTERNO.test(host))
    throw new LinkXmlInvalido("O link precisa ser de um endereço público.");
  if (/^\[|^[0-9.]+$/.test(host) || host.includes(":"))
    throw new LinkXmlInvalido("Use o nome do site, não um número de IP.");
  if (!/^[a-z0-9.-]+$/.test(host)) throw new LinkXmlInvalido("Link inválido.");
  // Mesma regra do banco (organization_xml_feeds_url_check): sem espaço.
  if (/\s/.test(s)) throw new LinkXmlInvalido("Link inválido.");
  return u;
}

function v4(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

/** IPv4 ou IPv6 que NÃO é internet pública. Formato desconhecido = tratado como privado. */
export function ipPrivado(ip: string): boolean {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const a = v4(s);
  if (a) {
    const [x, y] = a;
    return (
      x === 0 || x === 10 || x === 127 || x >= 224 ||
      (x === 100 && y >= 64 && y <= 127) || // CGNAT
      (x === 169 && y === 254) || // link-local / metadados de nuvem
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0 && (a[2] === 0 || a[2] === 2)) ||
      (x === 198 && (y === 18 || y === 19)) ||
      (x === 198 && y === 51 && a[2] === 100) ||
      (x === 203 && y === 0 && a[2] === 113)
    );
  }
  if (!s.includes(":")) return true;
  // IPv4 dentro do IPv6 (::ffff:10.0.0.1, ::10.0.0.1, 64:ff9b::10.0.0.1)
  const emb = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (emb) return ipPrivado(emb[1]);
  if (s === "::" || s === "::1") return true;
  const h = s.split(":")[0];
  const w = parseInt(h || "0", 16);
  if (Number.isNaN(w)) return true;
  return (
    (w & 0xfe00) === 0xfc00 || // fc00::/7 (rede interna)
    (w & 0xffc0) === 0xfe80 || // fe80::/10 (link-local)
    (w & 0xff00) === 0xff00 || // multicast
    (w === 0x2001 && parseInt(s.split(":")[1] || "0", 16) === 0x0db8) || // documentação
    s.startsWith("::ffff:") ||
    s.startsWith("100::") ||
    w === 0 // ::/8 e afins
  );
}

/** DNS por HTTPS (Cloudflare 1.1.1.1, formato application/dns-json), A + AAAA. */
export function resolverDoh(fetchFn: FetchLike = (u, i) => fetch(u, i)): ResolverDns {
  return async (host) => {
    const ips: string[] = [];
    for (const type of ["A", "AAAA"]) {
      const r = await fetchFn(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!r.ok) throw new Error("DNS indisponível");
      const j = (await r.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
      if (j.Status !== 0 && j.Status !== 3) throw new Error("DNS indisponível");
      for (const a of j.Answer ?? []) if (a.type === 1 || a.type === 28) ips.push(a.data);
    }
    return ips;
  };
}

/** Confere o link e os IPs do nome. Lança LinkXmlInvalido se não for seguro. */
export async function conferirDestino(raw: string, resolver: ResolverDns): Promise<URL> {
  const u = validarLinkXml(raw);
  let ips: string[];
  try {
    ips = await resolver(u.hostname);
  } catch {
    throw new LinkXmlInvalido("Não foi possível conferir o endereço do link agora.");
  }
  if (!ips.length) throw new LinkXmlInvalido("O endereço do link não existe.");
  if (ips.some(ipPrivado)) throw new LinkXmlInvalido("O link aponta para um endereço interno e foi bloqueado.");
  return u;
}

/**
 * fetch com as travas acima, seguindo no máximo 3 redirecionamentos (cada um conferido de novo).
 * shortcut: o DNS é conferido antes de cada pedido; um DNS que troque de IP entre a conferência e o pedido
 * (DNS rebinding) não é coberto aqui — no Cloudflare Worker o próprio runtime não alcança rede interna.
 */
export async function fetchXmlSeguro(
  url: string,
  init: RequestInit = {},
  deps: { fetchFn?: FetchLike; resolver?: ResolverDns } = {},
): Promise<Response> {
  const fetchFn = deps.fetchFn ?? ((u, i) => fetch(u, i));
  const resolver = deps.resolver ?? resolverDoh();
  let atual = url;
  for (let i = 0; i <= 3; i++) {
    const u = await conferirDestino(atual, resolver);
    const res = await fetchFn(u.toString(), { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`XML respondeu ${res.status}`);
      atual = new URL(loc, u).toString();
      continue;
    }
    return res;
  }
  throw new LinkXmlInvalido("O link redireciona demais.");
}
