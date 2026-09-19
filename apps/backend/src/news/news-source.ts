/**
 * Which addresses the server may be sent to, and how it gets there.
 *
 * 🔴 **This is the condition on fetching an article, not a feature of it.** Everywhere else in this app the
 * server decides its own destinations; here a person types one in. Unguarded, "fetch the article at this URL"
 * is a button that makes our process request anything reachable from this machine — `localhost`, the router,
 * a NAS, a cloud instance's metadata endpoint — and hand the body back to whoever asked (Cowork Round 925
 * §2.4). The article feature is the same code either way; the difference is entirely in this file.
 *
 * Kept in the backend rather than the contract deliberately (CLI Round 926 §4): if the screen held the list it
 * would judge an address before the redirects are followed, and the host that matters is the **last** one, not
 * the typed one. Only the side that actually opens the connection can know that, so only that side decides.
 */

/**
 * The publishers 캡틴D chose — 「주요 종합지·통신사」.
 *
 * 🟠 A list is the right shape here for a reason beyond safety: the summary is only as good as the body we can
 * parse out, and a parser breaks per publisher. A known set is a set we can actually check, and the screen can
 * say 「이 언론사는 아직 안 됩니다」 with a list rather than failing vaguely (Cowork Round 927 §5).
 *
 * 🔴 Being on this list is not a claim that the body parses — that is measured per publisher in step ③, and a
 * publisher whose body we cannot read falls back to pasting rather than silently producing a thin summary.
 * Adding a host here costs nothing and removes nothing; it only says "we may knock on this door".
 */
export const NEWS_SOURCE_HOSTS: readonly string[] = [
  "yna.co.kr",        // 연합뉴스
  "newsis.com",       // 뉴시스
  "chosun.com",
  "joongang.co.kr",
  "donga.com",
  "hani.co.kr",
  "khan.co.kr",
  "hankookilbo.com",
  "kbs.co.kr",
  "imbc.com",         // MBC
  "sbs.co.kr",
  "ytn.co.kr",
];

/** Anything larger is not an article, and reading it costs memory we have no reason to spend. */
export const NEWS_ARTICLE_MAX_BYTES = 2 * 1024 * 1024;
/** Publishers redirect (http→https, m.→www, AMP), but a chain this long is a redirector, not a publisher. */
export const NEWS_MAX_REDIRECTS = 5;

export type NewsSourceRefusal =
  /** Not a URL we can act on at all — unparseable, or a scheme that is not https. */
  | "unsupported_address"
  /** A real address, but not one of the publishers on the list. The person can act on this: use another paper. */
  | "publisher_not_allowed"
  /** An address that points back inside this machine or network. Never shown as "try a different one". */
  | "private_address"
  /** The chain of redirects did not settle. */
  | "too_many_redirects"
  /**
   * The page is bigger than we will read.
   *
   * 🔴 Its own value because it is its own instruction. Measured on the real sites (Round 940): 조선일보's front
   * page is **3.3MB**, so this fires — and under `unsupported_address` the person was told 「https 로 시작하는
   * 기사 주소를 넣어 주세요」 about an address that already did. The thing to do here is different from every
   * other refusal: **point at the article, not at the section front**.
   */
  | "page_too_large";

export class NewsSourceRefusedError extends Error {
  constructor(readonly reason: NewsSourceRefusal, readonly host?: string) {
    super(`News source refused (${reason}${host ? `: ${host}` : ""}).`);
    this.name = "NewsSourceRefusedError";
  }
}

const stripBrackets = (host: string): string => host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

/**
 * Whether a host is a literal address rather than a name, and if so whether it is one we must never call.
 *
 * 🔴 Refuses every literal, not only the private ones. A public literal has no legitimate use here — the
 * allowlist is a list of **names**, so an address that skips the name skips the list. Being strict costs
 * nothing (nobody types an IP for a news article) and removes the whole class of "which ranges did we
 * remember?" from the answer.
 *
 * The ranges are still spelled out below, because the error a person sees must distinguish "that is not a
 * publisher we know" from "that points inside your own network" — the second is never advice to try again.
 */
function literalAddressRefusal(host: string): NewsSourceRefusal | undefined {
  const bare = stripBrackets(host);
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a > 255 || b > 255 || Number(ipv4[3]) > 255 || Number(ipv4[4]) > 255) return "unsupported_address";
    const isPrivate = a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)          // link-local, and the cloud metadata endpoint lives here
      || (a === 100 && b >= 64 && b <= 127) // CGNAT
      || a >= 224;                          // multicast and reserved
    return isPrivate ? "private_address" : "publisher_not_allowed";
  }
  // IPv6, including the ::ffff:10.0.0.1 form that smuggles a v4 address through a v6 literal.
  if (bare.includes(":")) {
    const lower = bare.toLowerCase();
    const isPrivate = lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd")
      || lower.startsWith("fe80") || lower.startsWith("::ffff:");
    return isPrivate ? "private_address" : "publisher_not_allowed";
  }
  return undefined;
}

/** `localhost` and friends never reach DNS on most systems, and none of them are a publisher either way. */
const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

const isAllowedPublisher = (host: string): boolean =>
  NEWS_SOURCE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

/**
 * The one check, applied to the typed address and to **every** host a redirect leads to.
 *
 * 🟠 **The host is decided before the port and the credentials, and that order is the pair's subject.** Every
 * branch here refuses, so safety does not depend on the order — the *answer a person reads* does.
 * `https://www.yna.co.kr@192.168.0.1/` is their own router with a wire service's name pasted in front of the
 * `@`; deciding on the credentials first would answer 「지원하지 않는 주소」 and leave them adjusting the link.
 * The host is what we actually connect to, so the host is what the refusal is about. For the same reason the
 * inside-the-network answer is decided before the not-a-publisher one: somebody who pasted their NAS address
 * is not one newspaper away from success, and must never be told to try a different one.
 */
export function assertAllowedNewsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new NewsSourceRefusedError("unsupported_address"); }

  // https only. http would let anything between here and the publisher rewrite the article we are about to
  // summarise as fact — and every publisher on the list serves https.
  if (url.protocol !== "https:") throw new NewsSourceRefusedError("unsupported_address");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (LOCAL_NAMES.has(host)) throw new NewsSourceRefusedError("private_address", host);

  const literal = literalAddressRefusal(host);
  if (literal) throw new NewsSourceRefusedError(literal, host);

  if (!isAllowedPublisher(host)) throw new NewsSourceRefusedError("publisher_not_allowed", host);

  // A listed publisher on another port is a port scan wearing its name, and credentials are never part of an
  // article address — both are refused, but as "we do not speak that", since the host itself was fine.
  if (url.port && url.port !== "443") throw new NewsSourceRefusedError("unsupported_address", host);
  if (url.username || url.password) throw new NewsSourceRefusedError("unsupported_address", host);
  return url;
}

export interface NewsFetchResult {
  /** Where the body actually came from, after redirects — what the screen and the caption must credit. */
  finalUrl: string;
  body: string;
}

export interface NewsFetchDeps {
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * How long the whole fetch may take, redirects included.
 *
 * 🔴 **A host that accepts the connection and then says nothing is the cheapest attack on this route, and
 * without a deadline it works.** Nothing else here helps: the allowlist has already passed, the redirect
 * counter never advances because no response arrives, and the size cap has nothing to count. The request
 * simply waits, holding a handler, for as long as the other end cares to keep the socket open.
 *
 * One deadline for the whole chain rather than one per hop — five hops at ten seconds each is fifty seconds,
 * which is a timeout only in the sense that it eventually stops.
 */
export const NEWS_FETCH_TIMEOUT_MS = 10_000;

/**
 * Read the body, stopping at `maxBytes` instead of discovering afterwards that it was too big.
 *
 * 🔴 **This corrects what I shipped.** The cap used to be applied to the finished string, under a comment
 * saying a body is only bounded once it is in hand — which is not true, and the untrue part is the whole
 * point: `await response.text()` reads **everything** first. A cap that fires after the bytes are already in
 * this process's memory is not a cap, it is a report. The address is a person's input, so a response that
 * never ends is something to plan for rather than something to be surprised by.
 *
 * `Content-Length` is checked first because it is free, and **not trusted**, because it is the other end's
 * claim about itself. The running total is what actually decides; the header only saves us from starting.
 *
 * 🟠 Bytes, not characters, which is what the constant's name always said. `"가"` is three bytes of UTF-8 and
 * one character, so the old check let a Korean page reach three times the stated ceiling.
 */
/**
 * Which character set the bytes are in.
 *
 * 🔴 **Not always UTF-8, and assuming so is not a harmless default.** Measured against the real sites (Round
 * 940): MBC serves `text/html` with **no charset at all**, and decoding those bytes as UTF-8 produced a title
 * of replacement characters. A mangled body is not merely ugly — `checkNewsSummary` looks for the summary's
 * numbers and quotations *inside it*, so every real claim would come back missing and the person would be told
 * their accurate summary was invented.
 *
 * The header first, because it is the publisher's own statement. Then the document's own `<meta>`, which is
 * where a page that omits the header usually says it — read out of the raw bytes as Latin-1, since finding the
 * declaration is exactly the thing we cannot do until we know it. UTF-8 last, as the default it should be.
 */
function charsetOf(response: Response, bytes: Uint8Array): string {
  const declared = /charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1];
  if (declared) return declared.toLowerCase();
  // 2KB is past every <meta> that matters and short enough to be free.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  return (meta ?? "utf-8").toLowerCase();
}

/** A label `TextDecoder` will not take is not a reason to hand back nothing — UTF-8 is the better guess. */
function decodeWith(charset: string, bytes: Uint8Array): string {
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

async function readBounded(response: Response, maxBytes: number, host: string): Promise<string> {
  const tooBig = () => new NewsSourceRefusedError("page_too_large", host);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();

  const stream = response.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Cancel rather than break: the socket should stop sending, not finish into a buffer nobody reads.
      if (total > maxBytes) { await reader.cancel().catch(() => undefined); throw tooBig(); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return decodeWith(charsetOf(response, joined), joined);
}

/**
 * Fetch one article, checking **every** hop.
 *
 * 🔴 `redirect: "manual"` is the point of this function. Letting fetch follow redirects itself checks the
 * address the person typed and then goes wherever it is sent — so an allowed publisher's open redirector, or
 * simply a shortened link, walks straight past the list. The list has to be applied to the host that finally
 * answers, which means stepping through the chain here.
 */
export async function fetchNewsArticle(raw: string, deps: NewsFetchDeps = {}): Promise<NewsFetchResult> {
  const call = deps.fetch ?? globalThis.fetch;
  const maxRedirects = deps.maxRedirects ?? NEWS_MAX_REDIRECTS;
  const maxBytes = deps.maxBytes ?? NEWS_ARTICLE_MAX_BYTES;

  // One signal for the chain, created before the first hop, so redirects spend the same budget rather than
  // each getting a fresh one.
  const signal = AbortSignal.timeout(deps.timeoutMs ?? NEWS_FETCH_TIMEOUT_MS);

  let url = assertAllowedNewsUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await call(url.toString(), { redirect: "manual", headers: { Accept: "text/html" }, signal });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) {
      return { finalUrl: url.toString(), body: await readBounded(response, maxBytes, url.hostname) };
    }
    // Relative redirects are ordinary; resolving against the current URL is what a browser does, and the
    // result goes through the same door as the first address.
    url = assertAllowedNewsUrl(new URL(location, url).toString());
  }
  throw new NewsSourceRefusedError("too_many_redirects", url.hostname);
}
