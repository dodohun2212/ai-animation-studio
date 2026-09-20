// @vitest-environment node
//
// Reads source files off disk rather than rendering anything; jsdom gives `import.meta.url` an http:// URL,
// which cannot be turned back into a path. Same shape as no-provider-or-storage-access.test.ts next to it.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as url from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 2026-09-19 UI 재구성이 **한 군데에서만** 유지되는지 지키는 짝.
 *
 * 이 화면들의 색은 이제 `styles.css` 의 `@theme` 한 블록이 정합니다. 화면 60개가 여전히 `bg-slate-900`
 * 이라고 쓰고 있고, 그 이름이 가리키는 **값**을 그 블록이 따뜻한 먹색으로 옮겨 놓은 구조입니다.
 *
 * 🔴 그래서 위험이 둘입니다. 하나는 그 블록이 사라지는 것 — 그러면 아무 파일도 안 고쳤는데 **앱 전체가
 * 한 번에 남색으로 돌아갑니다.** 다른 하나는 어떤 화면이 자기만의 색을 다시 손으로 쓰는 것 — 그러면 그
 * 화면만 딴 세상이 되고, 그건 2차 작업 중에 실제로 일어났던 일입니다(목록은 따뜻한 검정인데 API 설정
 * 화면은 남색이었습니다).
 *
 * 둘 다 **화면을 열어 봐야만** 보이는 종류라, 소스를 훑는 짝으로 잡아 둡니다.
 */

/**
 * 손으로 쓰면 안 되는 것들. 전부 「이 값을 쓰지 말라」가 아니라 **「이 결정을 여기서 다시 내리지 말라」**
 * 입니다.
 */
const FORBIDDEN = [
  {
    pattern: /from-violet-500\s+to-fuchsia-500/,
    why: "손으로 쓴 보라 CTA — 이 앱의 주 버튼은 ui/surfaces.ts 의 primaryButton 하나뿐입니다. 17개 화면이 이 문자열을 각자 들고 있었고, 그래서 버튼 모양을 한 번 바꾸는 데 17군데를 고쳐야 했습니다.",
  },
  {
    pattern: /rgba\(139,\s*92,\s*246/,
    why: "보라 형광 그림자 — 어두운 화면에서 스스로 빛나 보여서, 정작 빛나야 할 사진보다 먼저 눈에 들어왔습니다.",
  },
  {
    pattern: /repeating-linear-gradient/,
    why: "반복 격자 — 34px 흰 선이 두 축으로 앱 전체에 깔려 있었습니다. 정보는 0이고 글자 뒤에서 계속 떨렸습니다.",
  },
];

/**
 * A floor, not an exact count — 옆 파일과 같은 이유입니다. 훑는 대상이 갑자기 비면 통과가 아니라 고장입니다.
 */
const MINIMUM_FILES_SWEPT = 80;

/**
 * 이 아래 숫자가 이 짝의 **핵심**입니다.
 *
 * 🔴 `slate-` 를 쓰는 파일이 이렇게 많다는 사실이, `styles.css` 의 재정의 블록을 지우면 안 되는 이유
 * 그 자체입니다. 둘을 한 짝 안에 넣어 둬야 「이 CSS 블록 왜 있지?」 하는 다음 사람이 **답을 같은 자리에서**
 * 봅니다. 바닥값으로 두는 건, 화면을 실제로 새 토큰(bone/ground/line)으로 옮길수록 이 수가 줄어들어야
 * 정상이기 때문입니다 — 줄어드는 건 진전이고, 0이 되면 그때 블록을 지우면 됩니다.
 */
const MINIMUM_FILES_STILL_ON_SLATE = 20;

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      found.push(path.relative(root, full));
    }
  }
  await walk(root);
  return found.sort();
}

describe("화면 색은 한 군데에서만 정해진다", () => {
  it("어떤 화면도 걷어낸 보라 CTA·형광 그림자·반복 격자를 다시 쓰지 않는다", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const files = await sourceFiles(root);
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_FILES_SWEPT);

    const offences: string[] = [];
    for (const relativePath of files) {
      const content = await fs.readFile(path.join(root, relativePath), "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        // 주석에서 「이걸 걷어냈다」고 설명하는 줄까지 잡으면, 이유를 적는 일이 벌을 받습니다.
        const inCodeOnly = content
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join("\n");
        if (pattern.test(inCodeOnly)) offences.push(`${relativePath}: ${why}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("styles.css 가 팔레트를 옮겨 놓은 채로 있다 — 이 블록이 사라지면 앱 전체가 한 번에 되돌아간다", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const css = await fs.readFile(path.join(root, "styles.css"), "utf8");

    // 따뜻한 먹색 쪽으로 옮겨 둔 중립 ramp 와, 구리로 옮겨 둔 강조.
    expect(css).toContain("--color-slate-900:");
    expect(css).toContain("--color-slate-100:");
    expect(css).toContain("--color-violet-500:");
    // 새로 쓰는 코드가 쓰는 이름들.
    expect(css).toContain("--color-ground:");
    expect(css).toContain("--color-bone:");
    expect(css).toContain("--spectrum:");
  });

  /**
   * 🔴 `smallOutlineButton` 이라는 **같은 이름이 열한 파일에 저마다** 적혀 있었고, 몸통이 **네 가지**였습니다 —
   * `py-1` 다섯, `py-1.5` 넷, 그리고 `bg-white/[0.06]` 에 `font-medium` 까지 붙은 것 둘. 한 화면에서 큰 버튼은
   * 따뜻한 뼈색으로 옮겨 갔는데 작은 버튼만 차가운 회색에 남아 있었습니다.
   *
   * 🟠 이 짝이 붙드는 건 **「하나뿐이다」**입니다. 색이나 크기가 아니라 **개수** — 다음 화면이 또 자기 것을
   * 적기 시작하면 여기서 빨개집니다. 열한 개가 네 가지로 갈라진 건 **한 번에 그렇게 된 게 아니라** 한 사람씩
   * 자기 파일에 적어서 그렇게 됐습니다.
   */
  it("ordinary 버튼은 한 군데에서만 정의된다 — 열다섯 벌이 여섯 가지로 갈라져 있었다", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const files = await sourceFiles(root);

    /*
     * 🟠 이름을 **표로** 둡니다. 다음에 또 하나가 갈라지기 시작하면 (`dangerOutlineButton`, `primaryButton` …)
     * 여기 한 줄을 더하는 것으로 끝나고, 짝을 새로 쓸 필요가 없습니다.
     */
    const SHARED = ["outlineButton", "smallOutlineButton"] as const;

    const localCopies: string[] = [];
    for (const relativePath of files) {
      if (relativePath.endsWith("ui/surfaces.ts")) continue;
      const content = await fs.readFile(path.join(root, relativePath), "utf8");
      for (const name of SHARED) {
        if (new RegExp(`^const ${name}\\s*=`, "m").test(content)) localCopies.push(`${relativePath}: ${name}`);
      }
    }

    expect(localCopies, "자기 파일에 다시 적지 말고 ui/surfaces.js 에서 가져오십시오").toEqual([]);
  });

  it("그 블록이 실제로 많은 화면을 떠받치고 있다 — 지우면 안 되는 이유가 숫자로 남는다", async () => {
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const files = await sourceFiles(root);

    let onSlate = 0;
    for (const relativePath of files) {
      const content = await fs.readFile(path.join(root, relativePath), "utf8");
      if (/\b(?:bg|text|border|from|to|via|ring|divide|placeholder)-slate-\d{2,3}\b/.test(content)) onSlate += 1;
    }

    expect(onSlate).toBeGreaterThanOrEqual(MINIMUM_FILES_STILL_ON_SLATE);
  });
});
