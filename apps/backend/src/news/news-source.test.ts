import { describe, expect, it, vi } from "vitest";

import {
  NEWS_SOURCE_HOSTS,
  NewsSourceRefusedError,
  assertAllowedNewsUrl,
  fetchNewsArticle,
} from "./news-source.js";

const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try { await promise; } catch (error) {
    if (error instanceof NewsSourceRefusedError) return error.reason;
    throw error;
  }
  throw new Error("expected a refusal, got none");
};

const refusalOf = (raw: string): string => {
  try { assertAllowedNewsUrl(raw); } catch (error) {
    if (error instanceof NewsSourceRefusedError) return error.reason;
    throw error;
  }
  throw new Error(`expected a refusal for ${raw}, got none`);
};

/** A fetch that answers from a script of hops, and records the options it was called with. */
function scriptedFetch(script: Record<string, { status?: number; location?: string; body?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const call = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = String(url);
    calls.push({ url: key, init });
    const hop = script[key];
    if (!hop) throw new Error(`unscripted request: ${key}`);
    if (hop.location) return new Response(null, { status: hop.status ?? 302, headers: { location: hop.location } });
    return new Response(hop.body ?? "<html>기사</html>", { status: hop.status ?? 200 });
  });
  return { call: call as unknown as typeof globalThis.fetch, calls };
}

describe("news source allowlist", () => {
  it("lets a publisher on the list through, including its subdomains", () => {
    expect(assertAllowedNewsUrl("https://www.yna.co.kr/view/AKR20260919").hostname).toBe("www.yna.co.kr");
    expect(assertAllowedNewsUrl("https://n.news.hani.co.kr/article/1").hostname).toBe("n.news.hani.co.kr");
    expect(assertAllowedNewsUrl("https://ytn.co.kr/_ln/0101").hostname).toBe("ytn.co.kr");
  });

  /**
   * 🔴 Suffix matching has to be on a dot boundary. `endsWith("yna.co.kr")` alone lets anyone who can register
   * `evil-yna.co.kr` — or `yna.co.kr.attacker.com` on the other side — hand us a page we then summarise as if a
   * wire service wrote it.
   */
  it("does not accept a name that merely ends in a publisher's", () => {
    expect(refusalOf("https://evil-yna.co.kr/a")).toBe("publisher_not_allowed");
    expect(refusalOf("https://yna.co.kr.attacker.com/a")).toBe("publisher_not_allowed");
    expect(refusalOf("https://notchosun.com/a")).toBe("publisher_not_allowed");
  });

  it("refuses a real newspaper we have not listed, and says so as something the person can act on", () => {
    expect(refusalOf("https://www.nytimes.com/2026/09/19/world.html")).toBe("publisher_not_allowed");
  });

  /**
   * 🔴 The whole reason this file exists. Each of these is a live address on the machine or the network this
   * server runs on, and "fetch that URL and show me the body" is a working read of all of them.
   */
  it("refuses every address that points back inside this machine or network", () => {
    for (const inside of [
      "https://localhost/a",
      "https://127.0.0.1/a",
      "https://127.9.9.9/a",
      "https://10.0.0.5/a",
      "https://172.16.0.1/a",
      "https://172.31.255.254/a",
      "https://192.168.0.1/a",
      "https://169.254.169.254/latest/meta-data/",   // the cloud metadata endpoint
      "https://100.64.0.1/a",                        // CGNAT
      "https://0.0.0.0/a",
      "https://[::1]/a",
      "https://[fd00::1]/a",
      "https://[fe80::1]/a",
      "https://[::ffff:10.0.0.1]/a",                 // a v4 private address wearing a v6 literal
    ]) {
      expect(refusalOf(inside), inside).toBe("private_address");
    }
  });

  /**
   * 🟠 The three refusals are separate values because the screen says three different things (Cowork Round 927
   * §5), and one of them must never be "try a different newspaper": somebody who pasted their own router's
   * address is not one paper away from success.
   */
  it("keeps the inside-the-network answer distinct from the wrong-publisher one", () => {
    expect(refusalOf("https://192.168.0.1/a")).not.toBe(refusalOf("https://www.nytimes.com/a"));
  });

  /**
   * 🔴 172.16–172.31 is private; 172.15 and 172.32 are not. Writing the range as `a === 172` would refuse real
   * addresses, and writing it as `b >= 16` alone would let 172.200.x through as if it were private — this pins
   * both edges so neither drifts.
   */
  it("gets the 172.16/12 edges right in both directions", () => {
    expect(refusalOf("https://172.15.0.1/a")).toBe("publisher_not_allowed");
    expect(refusalOf("https://172.32.0.1/a")).toBe("publisher_not_allowed");
    expect(refusalOf("https://172.16.0.1/a")).toBe("private_address");
    expect(refusalOf("https://172.31.0.1/a")).toBe("private_address");
  });

  /** A public literal is still refused — it skipped the list of names, which is the only thing we check. */
  it("refuses a bare address even when it is a public one", () => {
    expect(refusalOf("https://8.8.8.8/a")).toBe("publisher_not_allowed");
  });

  /**
   * 🔴 http would let anything sitting between this machine and the publisher rewrite the article — and the
   * summary we build from it is then presented to viewers as what a newspaper reported.
   */
  it("refuses anything that is not https", () => {
    expect(refusalOf("http://www.yna.co.kr/a")).toBe("unsupported_address");
    expect(refusalOf("file:///C:/Users/USER/.env")).toBe("unsupported_address");
    expect(refusalOf("ftp://www.yna.co.kr/a")).toBe("unsupported_address");
    expect(refusalOf("data:text/html,<p>기사</p>")).toBe("unsupported_address");
    expect(refusalOf("not a url at all")).toBe("unsupported_address");
  });

  /** An allowed name with a port attached is a port scan wearing a publisher's name. */
  it("refuses a non-default port even on a listed publisher", () => {
    expect(refusalOf("https://www.yna.co.kr:22/a")).toBe("unsupported_address");
    expect(refusalOf("https://www.yna.co.kr:8080/a")).toBe("unsupported_address");
    expect(assertAllowedNewsUrl("https://www.yna.co.kr:443/a").hostname).toBe("www.yna.co.kr");
  });

  /**
   * 🟠 A port on an address that is *also* not a publisher answers about the publisher, not the port — the host
   * is what we would have connected to, so the host is what the refusal is about. This is the pair that holds
   * the check order in place; with the port decided first, `https://192.168.0.1:8080/` reads as 「지원하지 않는
   * 주소」 and the fact that it points at their own network never reaches the screen.
   */
  it("answers about the host, not the port, when both are wrong", () => {
    expect(refusalOf("https://192.168.0.1:8080/a")).toBe("private_address");
    expect(refusalOf("https://www.nytimes.com:8080/a")).toBe("publisher_not_allowed");
  });

  /**
   * 🔴 `https://www.yna.co.kr@192.168.0.1/` is the router, not 연합뉴스. Every parser that reads the host as the
   * part before the `@` gets this wrong, and a person reading the address bar does too.
   */
  it("refuses credentials in the address, and is not fooled by a publisher's name before the @", () => {
    expect(refusalOf("https://www.yna.co.kr@192.168.0.1/a")).toBe("private_address");
    expect(refusalOf("https://user:pass@www.yna.co.kr/a")).toBe("unsupported_address");
  });

  it("is not fooled by case or a trailing dot on the host", () => {
    expect(assertAllowedNewsUrl("https://WWW.YNA.CO.KR/a").hostname).toBe("www.yna.co.kr");
    expect(refusalOf("https://LOCALHOST/a")).toBe("private_address");
    expect(refusalOf("https://localhost./a")).toBe("private_address");
  });

  it("lists publishers as bare registered names, so the suffix rule has something to match", () => {
    for (const host of NEWS_SOURCE_HOSTS) {
      expect(host, host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(host.startsWith("www."), host).toBe(false);
    }
  });
});

describe("news article fetch", () => {
  it("returns the body and where it actually came from", async () => {
    const { call } = scriptedFetch({ "https://www.yna.co.kr/view/1": { body: "<html>본문</html>" } });
    const result = await fetchNewsArticle("https://www.yna.co.kr/view/1", { fetch: call });
    expect(result.body).toBe("<html>본문</html>");
    expect(result.finalUrl).toBe("https://www.yna.co.kr/view/1");
  });

  it("follows an ordinary redirect within a publisher and credits the address it landed on", async () => {
    const { call } = scriptedFetch({
      "https://www.yna.co.kr/view/1": { location: "https://m.yna.co.kr/view/1" },
      "https://m.yna.co.kr/view/1": { body: "<html>본문</html>" },
    });
    const result = await fetchNewsArticle("https://www.yna.co.kr/view/1", { fetch: call });
    expect(result.finalUrl).toBe("https://m.yna.co.kr/view/1");
  });

  /**
   * 🔴 **The pair the whole function is for.** The typed address passes the list. The body comes from somewhere
   * else entirely. Checking only what the person typed is exactly the hole — a publisher's own open redirector,
   * a link shortener, or a hijacked path is enough to walk a request straight past a list that was applied once
   * at the front door.
   */
  it("refuses when a redirect leads off the list, however allowed the typed address was", async () => {
    const { call } = scriptedFetch({
      "https://www.yna.co.kr/out?url=x": { location: "https://attacker.example.com/page" },
    });
    expect(await refusal(fetchNewsArticle("https://www.yna.co.kr/out?url=x", { fetch: call })))
      .toBe("publisher_not_allowed");
  });

  /** And the version that matters most: a redirect aimed back inside the network. */
  it("refuses when a redirect leads to an address inside this machine", async () => {
    const { call } = scriptedFetch({
      "https://www.yna.co.kr/out?url=x": { location: "https://169.254.169.254/latest/meta-data/" },
    });
    expect(await refusal(fetchNewsArticle("https://www.yna.co.kr/out?url=x", { fetch: call })))
      .toBe("private_address");
  });

  /**
   * 🔴 Pins the request option rather than a behaviour, because here the option **is** the guard. With
   * `redirect: "follow"` the runtime walks the chain itself and hands back only the final body — every check
   * above still passes, every test above stays green, and nothing in this file would ever see the second host.
   * There is no way to observe that difference through a stubbed fetch, so it is asserted directly.
   */
  it("asks the runtime not to follow redirects, which is what makes the per-hop check possible", async () => {
    const { call, calls } = scriptedFetch({ "https://www.yna.co.kr/view/1": { body: "본문" } });
    await fetchNewsArticle("https://www.yna.co.kr/view/1", { fetch: call });
    expect(calls[0]?.init?.redirect).toBe("manual");
  });

  it("resolves a relative redirect against the current address, then checks it like any other", async () => {
    const { call } = scriptedFetch({
      "https://www.yna.co.kr/view/1": { location: "/view/1-final" },
      "https://www.yna.co.kr/view/1-final": { body: "본문" },
    });
    expect((await fetchNewsArticle("https://www.yna.co.kr/view/1", { fetch: call })).finalUrl)
      .toBe("https://www.yna.co.kr/view/1-final");
  });

  it("gives up on a chain that never settles instead of following it forever", async () => {
    const { call } = scriptedFetch({ "https://www.yna.co.kr/loop": { location: "https://www.yna.co.kr/loop" } });
    expect(await refusal(fetchNewsArticle("https://www.yna.co.kr/loop", { fetch: call, maxRedirects: 3 })))
      .toBe("too_many_redirects");
  });

  it("refuses a response too large to be an article", async () => {
    const { call } = scriptedFetch({ "https://www.yna.co.kr/big": { body: "가".repeat(5000) } });
    expect(await refusal(fetchNewsArticle("https://www.yna.co.kr/big", { fetch: call, maxBytes: 1000 })))
      .toBe("unsupported_address");
  });

  /** The refusal happens before any connection — a disallowed address must not even be knocked on. */
  it("never calls out at all for an address that fails the list", async () => {
    const { call, calls } = scriptedFetch({});
    await refusal(fetchNewsArticle("https://192.168.0.1/a", { fetch: call }));
    expect(calls).toHaveLength(0);
  });
});
