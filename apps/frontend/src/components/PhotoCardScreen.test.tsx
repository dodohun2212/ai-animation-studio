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

  // A folder is not a picture, and an asset whose file cannot be read would be refused by the server after the
  // person had already chosen it and pressed the button. Both are filtered here so the only things offered are
  // things that can actually be used.
  it("offers only assets that are real, readable pictures", async () => {
    stub(jsonResponse(200, { assets: [picture, folder, missing] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);

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
    render(<PhotoCardScreen onBack={() => {}} onCreated={onCreated} />);
    await fillAndSubmit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("quote_01"));
    const call = fetchMock.mock.calls.find(([url]) => url === "/photo-cards");
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      projectId: "quote_01",
      assetId: "ASSET-1",
      quote: "천천히 서두르라",
      clipDurationSeconds: 5,
      aspectRatio: "9:16",
    });
  });

  // The button stays out of reach until the three things the server requires are present. Without this the
  // person presses it, waits, and reads a refusal that only says what they could have been told before.
  it("will not submit until a picture, a quote and a name are all there", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
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
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
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
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
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
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
    fireEvent.click(await screen.findByTestId("photo-card-asset-ASSET-1"));
    fireEvent.change(screen.getByTestId("photo-card-quote"), { target: { value: "문장" } });
    fireEvent.change(screen.getByTestId("photo-card-id"), { target: { value: "명언_불광불급" } });

    await waitFor(() => expect((screen.getByTestId("photo-card-submit") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("photo-card-id-taken")).toBeNull();
  });

  // The other half: the rule allows any letter, so a plain Korean name must not be caught by it.
  it("accepts a Korean name without punctuation", async () => {
    stub(jsonResponse(200, { assets: [picture] }));
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
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
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);
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
    const rendered = render(<PhotoCardScreen onBack={() => {}} onCreated={onCreated} />);
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
    render(<PhotoCardScreen onBack={() => {}} onCreated={() => {}} />);

    const note = (await screen.findByTestId("photo-card-music-note")).textContent ?? "";
    expect(note).toContain("영상 합치기");
    // Said where the decision is made, not only in the header far above it.
    expect(note).toContain("비용이 들지 않습니다");
  });
});
