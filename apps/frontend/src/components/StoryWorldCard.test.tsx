import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { StoryWorldCard } from "./StoryWorldCard.js";

const emptyBible = { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };

/**
 * These tests moved here from LongStoryBibleScreen.test.tsx with the control itself. 세계관 is a property of
 * the work — script generation reads it from the project once per prompt — so it is edited in 작품 기본 설정
 * beside 주인공 and 전체 그림체, not behind a tab on a screen about characters.
 */
describe("StoryWorldCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  // A section that opens with a sentence, a button, and nowhere to type reads as a section that does not work.
  // That is how it was reported — twice, as "세계관 설정은 입력 자체가 안 돼".
  it("opens with a line ready to type in, and keeps what is typed before it is named", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: emptyBible })));
    render(<StoryWorldCard projectId="long_test" />);

    const card = await screen.findByTestId("story-world-card");
    expect(within(card).getAllByLabelText("무엇에 대한 설명인지")).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "세계관 설명에 항목 추가" }));

    // The row list used to be derived from the stored JSON on every render, and a blank name is dropped on the
    // way into that JSON because it is not a valid key. So 항목 추가 produced no row at all, and text typed
    // before naming the row was written under an empty key and thrown away.
    const names = within(card).getAllByLabelText("무엇에 대한 설명인지");
    expect(names).toHaveLength(2);
    fireEvent.change(within(card).getAllByLabelText("세계관 내용")[1]!, { target: { value: "바다 위 도시" } });
    fireEvent.change(names[1]!, { target: { value: "지역" } });
    expect(within(card).getAllByLabelText("세계관 내용")[1]!).toHaveValue("바다 위 도시");
  });

  it("sends the rows as a JSON object only when 저장 is pressed", async () => {
    const saved = { ...emptyBible, world: { 지역: "바다 위 도시" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: saved }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryWorldCard projectId="long_test" />);

    const card = await screen.findByTestId("story-world-card");
    fireEvent.change(within(card).getAllByLabelText("무엇에 대한 설명인지")[0]!, { target: { value: "지역" } });
    fireEvent.change(within(card).getAllByLabelText("세계관 내용")[0]!, { target: { value: "바다 위 도시" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(card).getByRole("button", { name: "세계관 설명 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/story-bible/world");
    expect(JSON.parse(String(init.body))).toEqual({ world: { 지역: "바다 위 도시" } });
  });

  it("says nothing about basic at all, so it cannot clear the links stored there", async () => {
    // 주인공 and 전체 그림체 live inside `basic`. This card used to have to read it back and hand it in
    // unchanged, because the endpoint replaced both halves and omitting it cleared both. The request cannot
    // carry `basic` any more, so the card no longer reads it and cannot get it wrong.
    const withBasic = { ...emptyBible, basic: { title: "이배드의 탄생", protagonist_asset_link: { assetId: "FOLDER-1" } } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: withBasic }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryWorldCard projectId="long_test" />);

    const card = await screen.findByTestId("story-world-card");
    fireEvent.click(within(card).getByRole("button", { name: "세계관 설명 저장" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).not.toHaveProperty("basic");
  });

  it("refuses a non-object in the raw editor before making a request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StoryWorldCard projectId="long_test" />);

    await screen.findByTestId("story-world-card");
    fireEvent.change(screen.getByLabelText("세계관 설정 JSON"), { target: { value: "[]" } });
    fireEvent.click(screen.getByRole("button", { name: "세계관 설명 저장" }));
    expect(screen.getByTestId("story-world-validation-error").textContent).toContain("세계관 설정");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps nested data out of the table rather than flattening it away", async () => {
    // The table can only express string values. Rewriting a nested world into one silently destroys data, so
    // those projects keep the raw editor as their only surface — and are told why.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: { ...emptyBible, world: { 지역: { 이름: "바다 위 도시" } } } })));
    render(<StoryWorldCard projectId="long_test" />);

    expect(await screen.findByTestId("story-world-unsupported")).toBeTruthy();
    expect(screen.queryByLabelText("무엇에 대한 설명인지")).toBeNull();
    expect(screen.getByLabelText("세계관 설정 JSON")).toBeTruthy();
  });

  // The "when is this read" test moved to LongProjectSettingsScreen.test.tsx with the notice itself. Four
  // cards on that screen each stated the same rule; it is now stated once, above all four.
});
