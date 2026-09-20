import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerOutOfBand, jsonResponse, makeAsset, makeAssetFolder, makeProject, withStatus } from "../api/testUtils.js";
import { PhotoCardScreen } from "./PhotoCardScreen.js";

const picture = makeAsset({ assetId: "ASSET-1", displayName: "밤하늘", imageAvailable: true, contentUrl: "/assets/ASSET-1/content" });
// makeAssetFolder, not makeAsset({ isFolder: true }) — that leaves the non-folder digest in place, the response
// validator rejects the whole list as malformed, and nothing renders at all. testUtils' own doc comment says so.
const folder = makeAssetFolder({ assetId: "FOLDER-1", displayName: "캐릭터 폴더" });
const missing = makeAsset({ assetId: "ASSET-GONE", displayName: "파일 없는 그림", imageAvailable: false, contentUrl: null });

/**
 * The project list is answered out of band, not threaded into the call-order chain.
 *
 * The screen gained a second mount request — the existing project names, so a name that is already taken is
 * refused beside the field instead of coming back as a failure. Every test below queues its responses in
 * order, and dropping one more into that queue would hand the create response to whichever mount effect
 * happened to run second. Only the tests that care about existing names say anything about them.
 *
 * `names` is either the ids that already exist, or a raw route answer (see `withStatus`) for the failure case.
 */
function stubWithExistingNames(names: unknown, ...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const listing = Array.isArray(names) ? { projects: names.map((id: string) => makeProject({ id })) } : names;
  vi.stubGlobal("fetch", answerOutOfBand({ "GET /projects": listing }, fetchMock));
  return fetchMock;
}

function stub(...responses: Response[]) {
  return stubWithExistingNames([], ...responses);
}

async function fillAndSubmit() {
  fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
  fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "  천천히 서두르라  " } });
  fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: " quote_01 " } });
  fireEvent.click(screen.getByTestId("photo-card-submit"));
}

describe("PhotoCardScreen", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 사진 여러 장 — **고르는 것이 곧 길이를 고르는 것**입니다(계약 주석, CLI Round 950).
   *
   * 🔴 카드는 예전엔 장면 하나라 「길이」가 곧 완성 길이였습니다. 이제 사진마다 장면 하나라
   * **장수 × 한 장당 길이**가 완성 길이인데, 화면이 그 말을 안 하면 세 장을 고른 사람은 10초짜리를 기대하고
   * 30초를 받습니다 — 그리고 그건 **다 구워진 뒤에야** 압니다.
   */
  describe("사진 여러 장", () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) =>
      makeAsset({ assetId: `P${n}`, displayName: `그림${n}`, imageAvailable: true, contentUrl: `/assets/P${n}/content` }));

    async function renderWith(assets: unknown[], ...rest: Response[]) {
      stub(jsonResponse(200, { assets }), ...rest);
      render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
      await screen.findByTestId(`photo-card-asset-${(assets[0] as { assetId: string }).assetId}`);
    }

    const pick = (id: string) => fireEvent.click(screen.getByTestId(`photo-card-asset-${id}`));

    /**
     * 🔴 순서가 이 짝의 전부입니다. 계약이 *「in the order they are shown — one scene each」* 라, 고른 순서가
     * 그대로 **재생 순서**가 됩니다. 정렬이 한 줄 끼어들면 화면은 그대로인데 **영상의 순서가 바뀝니다** —
     * 그리고 그건 되돌릴 수 없는 결과물에 실립니다.
     */
    it("고른 순서 그대로 보내고, 화면에도 그 번호가 보인다", async () => {
      const fetchMock = stub(
        jsonResponse(200, { assets: many.slice(0, 3) }),
        jsonResponse(201, { project: makeProject({ id: "quote_01" }) }),
      );
      render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
      await screen.findByTestId("photo-card-asset-P1");

      // 일부러 목록 순서와 다르게 고릅니다 — 목록 순서로 보내면 이 짝이 잡습니다.
      pick("P3"); pick("P1"); pick("P2");

      expect(screen.getByTestId("photo-card-order-P3").textContent).toBe("1");
      expect(screen.getByTestId("photo-card-order-P1").textContent).toBe("2");
      expect(screen.getByTestId("photo-card-order-P2").textContent).toBe("3");

      fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
      fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "quote_01" } });
      fireEvent.click(screen.getByTestId("photo-card-submit"));

      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/photo-cards")).toBe(true));
      const call = fetchMock.mock.calls.find(([url]) => url === "/photo-cards")!;
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { assetIds: string[] };
      expect(body.assetIds).toEqual(["P3", "P1", "P2"]);
    });

    it("다시 누르면 빠지고, 남은 것들의 번호가 당겨진다", async () => {
      await renderWith(many.slice(0, 3));
      pick("P1"); pick("P2"); pick("P3");

      pick("P1");

      expect(screen.queryByTestId("photo-card-order-P1")).toBeNull();
      /*
       * 🟠 「빠졌다」만 보면 부족합니다. 번호가 그대로 2·3 으로 남으면 **1번이 없는 카드**가 되고, 그건
       * 화면이 순서에 대해 거짓말을 하는 것입니다.
       */
      expect(screen.getByTestId("photo-card-order-P2").textContent).toBe("1");
      expect(screen.getByTestId("photo-card-order-P3").textContent).toBe("2");
    });

    it("길이를 「장수 × 한 장당 길이」로 말하고, 둘 중 뭘 바꿔도 따라온다", async () => {
      await renderWith(many.slice(0, 3));
      const line = () => screen.getByTestId("photo-card-length").textContent ?? "";

      // 🔴 한 장도 안 골랐을 때 숫자를 말하면 안 됩니다 — 0초는 만들 수 있는 카드가 아닙니다.
      expect(line()).toContain("아직 고른 그림이 없습니다");

      pick("P1");
      expect(line()).toContain("사진 1장");
      pick("P2");
      expect(line()).toContain("사진 2장");

      // 기본값은 PHOTO_CARD_DURATIONS[0] = 5초라, 두 장이면 10초입니다.
      expect(line()).toContain("= 10초");

      fireEvent.change(screen.getByTestId("photo-card-seconds"), { target: { value: "10" } });
      /*
       * 🔴 「장수를 바꾸면 바뀐다」만 박으면, 한 장당 길이를 곱하지 않고 **장수만 쓰는 판**도 통과합니다.
       * 곱셈이 살아 있는지는 **다른 쪽 피연산자**를 바꿔 봐야 압니다 — 같은 두 장인데 20초여야 합니다.
       */
      expect(line()).toContain("한 장당 10초");
      expect(line()).toContain("= 20초");
    });

    /**
     * 🔴 이 짝이 이 묶음에서 제일 중요합니다. 「12장이 찼다」를 이유로 격자 전체를 닫으면, 잘못 고른 한 장을
     * **바꿀 수가 없어서** 사람이 갇힙니다 — 나가는 길은 폼을 처음부터 다시 채우는 것뿐입니다.
     */
    it("상한에 닿으면 안 고른 것만 닫히고, 고른 것은 계속 뺄 수 있다", async () => {
      await renderWith(many);
      for (const one of many.slice(0, 12)) pick(one.assetId);

      expect(screen.getByTestId("photo-card-limit")).toBeTruthy();
      expect((screen.getByTestId("photo-card-asset-P13") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId("photo-card-asset-P1") as HTMLButtonElement).disabled).toBe(false);

      pick("P1");
      expect(screen.queryByTestId("photo-card-order-P1")).toBeNull();
      // 자리가 나면 닫힌 것이 다시 열립니다 — 그리고 안내도 같이 사라져야 합니다.
      expect((screen.getByTestId("photo-card-asset-P13") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByTestId("photo-card-limit")).toBeNull();
    });

    it("한 장도 안 고르면 만들기가 닫혀 있다", async () => {
      await renderWith(many.slice(0, 2));
      fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
      fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "quote_01" } });

      expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(true);
      pick("P1");
      expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(false);
      // 뺐으면 다시 닫힙니다 — 「한 번이라도 골랐으면 열린 채로」가 되면 안 됩니다.
      pick("P1");
      expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(true);
    });
  });

  // A folder is not a picture, and an asset whose file cannot be read would be refused by the server after the
  // person had already chosen it and pressed the button. Both are filtered here so the only things offered are
  // things that can actually be used.
  it("offers only assets that are real, readable pictures", async () => {
    stub(jsonResponse(200, { assets: [picture, folder, missing] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);

    expect(await screen.findByTestId("photo-card-asset-ASSET-1")).toBeTruthy();
    expect(screen.queryByTestId("photo-card-asset-FOLDER-1")).toBeNull();
    expect(screen.queryByTestId("photo-card-asset-ASSET-GONE")).toBeNull();
  });

  it("sends the trimmed quote and id with the chosen picture, then hands the card to the merge screen", async () => {
    const fetchMock = stub(
      jsonResponse(200, { assets: [picture] }),
      jsonResponse(200, { project: makeProject({ id: "quote_01", photoCard: true }) }),
    );
    const onCreated = vi.fn();
    render(<PhotoCardScreen onBack={() => {}} onCreated={onCreated} onOpenCard={() => {}} />);
    await fillAndSubmit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("quote_01"));
    const call = fetchMock.mock.calls.find(([url]) => url === "/photo-cards");
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      projectId: "quote_01",
      // 🟠 A list, holding the one picture this screen can choose. Each entry becomes a scene, so a card's
      // length is now `pictures × clipDurationSeconds` — the picker for several is not built yet (CLI 950).
      assetIds: ["ASSET-1"],
      quote: "천천히 서두르라",
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
    });
  });

  // Was a `vertical` boolean that could only ever send "9:16" or "16:9" — item 6 gave the field two more real
  // values (1:1, then 4:5), so both are asserted here rather than just the one the boolean already had room for.
  it("offers all four aspect ratios and sends the one actually chosen", async () => {
    const fetchMock = stub(
      jsonResponse(200, { assets: [picture] }),
      jsonResponse(200, { project: makeProject({ id: "quote_01", photoCard: true }) }),
    );
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);

    const select = (await screen.findByTestId("photo-card-aspect")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["9:16", "16:9", "1:1", "4:5"]);

    fireEvent.change(select, { target: { value: "4:5" } });
    await fillAndSubmit();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/photo-cards")).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => url === "/photo-cards")!;
    const body = JSON.parse(String((call[1] as RequestInit).body)) as { aspectRatio: string };
    expect(body.aspectRatio).toBe("4:5");
  });

  // The button stays out of reach until the three things the server requires are present. Without this the
  // person presses it, waits, and reads a refusal that only says what they could have been told before.
  it("will not submit until a picture, a quote and a name are all there", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    await screen.findByTestId("photo-card-asset-ASSET-1");

    const submit = () => screen.getByTestId("photo-card-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("photo-card-asset-ASSET-1"));
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "quote_01" } });
    expect(submit().disabled).toBe(false);
  });

  /**
   * 명언(불광불급) was a real attempt. The server rejects the brackets and answers "입력 내용을 확인해 주세요",
   * which names neither the field nor the character — so the refusal has to happen here, beside the box, and
   * has to say what is actually wrong. Korean letters are fine; punctuation is not.
   */
  it("refuses a name the server would reject, and says which characters are the problem", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언(불광불급)" } });

    expect((await screen.findByTestId("photo-card-id-invalid")).textContent).toContain("괄호");
    expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * The card that was already made.
   *
   * 명언_불광불급 went through: the project was written, the picture copied beside it, the record saved. The
   * second press on the same name answered "사진 카드를 저장하지 못했습니다" — about a finished card — because
   * the photo-card path wraps the server's already-exists refusal in its storage error. Until that is
   * untangled, and after it too, the name field is the only place that can say so before the press.
   */
  it("refuses a name that already belongs to a project", async () => {
    stubWithExistingNames(["명언_불광불급"], jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언_불광불급" } });

    expect((await screen.findByTestId("photo-card-id-taken")).textContent).toContain("이미 있습니다");
    expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  // The check is a convenience, never the guard. If the listing cannot be read the button stays usable and the
  // server does what it has always done — otherwise one failing request would lock a screen that works.
  it("leaves the button usable when the project list cannot be read", async () => {
    stubWithExistingNames(withStatus(500, { code: "STORAGE_ERROR", message: "" }), jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언_불광불급" } });

    await waitFor(() => expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("photo-card-id-taken")).toBeNull();
  });

  // The other half: the rule allows any letter, so a plain Korean name must not be caught by it.
  it("accepts a Korean name without punctuation", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언_불광불급" } });

    expect(screen.queryByTestId("photo-card-id-invalid")).toBeNull();
    expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  // A whitespace-only quote is not a quote. Trimming happens before the check, or the button unlocks on a line
  // the server will refuse — and the count next to it would read as though something had been typed.
  it("treats a quote of only spaces as empty", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "quote_01" } });
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "    " } });

    expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("photo-card-quote-count").textContent).toContain("0 /");
  });

  // The one failure that is not a retry: the picture cannot be read, and pressing again reads the same file.
  // The message has to name the move that works — choosing a different picture — and must not leak the
  // server's own text, which carries file paths.
  it("tells the person to choose another picture when the chosen one cannot be read", async () => {
    stub(
      jsonResponse(200, { assets: [picture] }),
      jsonResponse(500, { code: "PHOTO_CARD_ASSET_UNUSABLE", message: "raw C:\\assets\\ASSET-1.png" }),
    );
    const onCreated = vi.fn();
    const rendered = render(<PhotoCardScreen onBack={() => {}} onCreated={onCreated} onOpenCard={() => {}} />);
    await fillAndSubmit();

    const alert = await screen.findByTestId("photo-card-error");
    expect(alert).toHaveAttribute("data-error-code", "PHOTO_CARD_ASSET_UNUSABLE");
    expect(alert.textContent).toContain("다른 그림");
    expect(alert.textContent).not.toContain("잠시 후");
    expect(rendered.container.innerHTML).not.toContain("assets\\ASSET-1.png");
    expect(onCreated).not.toHaveBeenCalled();
  });

  // Music is chosen at merge time, together with the credit line some tracks require. Saying so here is the
  // difference between "this screen forgot about music" and "music comes next".
  it("says where music is chosen instead of leaving it unmentioned", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);

    const note = (await screen.findByTestId("photo-card-music-note")).textContent ?? "";
    expect(note).toContain("영상 합치기");
    // Said where the decision is made, not only in the header far above it.
    expect(note).toContain("비용이 들지 않습니다");
  });

  /**
   * 🟠 만들어 둔 카드 목록은 **이 화면에서 나갔습니다**(`PhotoCardListScreen`). 여기 있던 짝 셋도 같이
   * 옮겼습니다 — 카드 한 장 보려고 들어온 사람이 만들기 폼을 전부 지나가야 했던 게 가른 이유입니다.
   *
   * 🔴 남은 건 이것 하나입니다. 이 화면은 여전히 `/projects` 를 읽는데, 이제 그걸로 하는 일은
   * **이름이 겹치는지 미리 보는 것뿐**입니다. 그래서 실패했을 때 할 말도 하나뿐입니다 — 그리고
   * **만들기를 막으면 안 됩니다.** 막는 건 서버고, 읽기 한 번 실패한 것이 만들기를 막으면 그건 이 화면이
   * 할 수 있는 일보다 큰 말입니다.
   */
  it("이름 목록을 못 읽어도 만들기는 그대로 열려 있다", async () => {
    stubWithExistingNames(
      withStatus(500, { code: "PROJECT_STORAGE_ERROR", message: "raw backend detail" }),
      jsonResponse(200, { assets: [picture] }),
    );
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={() => {}} />);

    const notice = await screen.findByTestId("photo-card-names-unchecked");
    expect(notice.textContent).toContain("미리 확인하지 못했습니다");
    expect(notice.textContent).not.toContain("raw backend detail");

    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "quote_01" } });
    expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  /**
   * 🟠 이름이 겹친다고 말하는 것만으로는 **막다른 길**입니다. 그 카드는 이미 있고, 사람이 하려던 일은
   * 대개 그걸 여는 것입니다 — 그래서 그 자리에서 열 수 있어야 합니다.
   */
  it("겹친 이름을 말할 때, 그 카드로 가는 길을 같이 준다", async () => {
    const onOpenCard = vi.fn();
    stubWithExistingNames(["명언_불광불급"], jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} onOpenCard={onOpenCard} />);
    await screen.findByTestId("photo-card-asset-ASSET-1");

    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언_불광불급" } });

    expect((await screen.findByTestId("photo-card-id-taken")).textContent).toContain("이미 있습니다");
    fireEvent.click(screen.getByTestId("photo-card-open-taken"));
    expect(onOpenCard).toHaveBeenCalledWith("명언_불광불급");
  });
});
