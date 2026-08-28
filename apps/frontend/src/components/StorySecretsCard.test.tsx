import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { StorySecretsCard } from "./StorySecretsCard.js";

const emptyBible = { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };

/**
 * Moved here from LongStoryBibleScreen.test.tsx with the controls. 비밀·복선 are the two collections whose text
 * actually reaches the script prompt, and they were the hardest two to find — behind the fourth and fifth tabs
 * of a screen about characters, whose own three tabs reach the prompt with nothing.
 */
describe("StorySecretsCard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the text of a secret, and for when it may be used", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: { id: "SECRET-1", name: "출생의 비밀" }, storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    await screen.findByTestId("story-secrets-empty-secrets");
    fireEvent.change(screen.getByLabelText("비밀 이름"), { target: { value: "출생의 비밀" } });
    fireEvent.change(screen.getByLabelText("비밀 내용"), { target: { value: "이베드는 기록관이 만든 존재다." } });
    fireEvent.change(screen.getByLabelText("비밀 공개 가능 회차"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/story-bible/secrets");
    expect(JSON.parse(String(init.body)).item).toMatchObject({
      name: "출생의 비밀",
      description: "이베드는 기록관이 만든 존재다.",
      // The field the whole reveal split turns on. Without it every secret defaults to Episode 1 — always
      // revealable — and the "you must not use this yet" half of the prompt covers nothing.
      revealAvailableEpisode: 8,
    });
  });

  it("posts 복선 to its own collection, not to 비밀", async () => {
    // Two lists on one card is the shape that makes this worth a test: a single mistaken `collection` would
    // silently file every foreshadow as a secret, and both render the same way.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: { id: "FS-1", name: "깨진 시계" }, storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    await screen.findByTestId("story-secrets-empty-foreshadowing");
    fireEvent.change(screen.getByLabelText("복선 이름"), { target: { value: "깨진 시계" } });
    fireEvent.click(screen.getByRole("button", { name: "복선 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe("/long-projects/long_test/story-bible/foreshadowing");
  });

  it("leaves the reveal Episode out of the request when it is blank", async () => {
    // Blank means "from the first Episode", which is what the server already defaults to. Sending 0 or NaN
    // instead would be a number the person never chose.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: { id: "SECRET-1", name: "비밀" }, storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    await screen.findByTestId("story-secrets-empty-secrets");
    fireEvent.change(screen.getByLabelText("비밀 이름"), { target: { value: "비밀" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀 추가" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)).item).not.toHaveProperty("revealAvailableEpisode");
  });

  it("clears a stored reveal Episode when the box is emptied", async () => {
    // Update replaces the whole item and this card merges over the stored one, so an omitted key would keep the
    // old number: the field would look cleared and not be. Clearing it is a deliberate "from Episode 1".
    const stored = { ...emptyBible, secrets: [{ id: "SECRET-1", name: "출생의 비밀", description: "본문", revealAvailableEpisode: 8 }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: stored }))
      .mockResolvedValueOnce(jsonResponse(200, { item: stored.secrets[0], storyBible: stored }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    const list = await screen.findByRole("list", { name: "비밀 목록" });
    fireEvent.click(within(list).getByRole("button", { name: "수정" }));
    expect(screen.getByLabelText("비밀 공개 가능 회차")).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("비밀 공개 가능 회차"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 사항 저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/story-bible/secrets/SECRET-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body)).item).not.toHaveProperty("revealAvailableEpisode");
  });

  it("requires a name locally and does not send an empty one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    await screen.findByTestId("story-secrets-empty-secrets");
    fireEvent.click(screen.getByRole("button", { name: "비밀 추가" }));
    expect(screen.getByTestId("story-secrets-validation-secrets").textContent).toContain("이름");
    // The refusal belongs to the list that was submitted, not to the card: two lists share this screen.
    expect(screen.queryByTestId("story-secrets-validation-foreshadowing")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit second action before deleting", async () => {
    const stored = { ...emptyBible, secrets: [{ id: "SECRET-1", name: "출생의 비밀" }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: stored }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StorySecretsCard projectId="long_test" />);

    const list = await screen.findByRole("list", { name: "비밀 목록" });
    fireEvent.click(within(list).getByRole("button", { name: "삭제" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("alertdialog", { name: "비밀·복선 삭제 확인" });
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/long-projects/long_test/story-bible/secrets/SECRET-1");
    expect(init.method).toBe("DELETE");
  });

  it("keeps raw backend details out of the error UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\absolute\\raw detail" })));
    render(<StorySecretsCard projectId="long_test" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_STORAGE_ERROR");
    expect(alert.textContent).not.toContain("absolute");
  });
});
