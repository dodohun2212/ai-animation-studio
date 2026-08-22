import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { LongStoryBibleScreen } from "./LongStoryBibleScreen.js";

const emptyBible = { basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], updatedAt: "2026-08-23T00:00:00.000Z" };
const characterBible = { ...emptyBible, characters: [{ id: "CHAR-1", name: "Mina", description: "pilot", status: "active" }] };

describe("LongStoryBibleScreen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads an empty collection, validates name locally, and creates an item", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: emptyBible }))
      .mockResolvedValueOnce(jsonResponse(201, { item: characterBible.characters[0], storyBible: characterBible }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    expect(await screen.findByTestId("story-bible-empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByTestId("story-bible-validation-error")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Item ID"), { target: { value: "CHAR-1" } });
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Mina" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    await screen.findByText("Mina");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/long-projects/long_test/story-bible/characters");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("edits an item and requires an explicit second action before delete", async () => {
    const revised = { ...characterBible, characters: [{ ...characterBible.characters[0], name: "Mina revised" }] };
    const deleted = { ...emptyBible };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: characterBible }))
      .mockResolvedValueOnce(jsonResponse(200, { item: revised.characters[0], storyBible: revised }))
      .mockResolvedValueOnce(jsonResponse(200, { storyBible: deleted }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);

    await screen.findByText("Mina");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "Mina revised" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Mina revised");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("keeps raw backend details out of the error UI and supports all five tabs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "LONG_PROJECT_STORAGE_ERROR", message: "C:\\absolute\\raw detail" })));
    render(<LongStoryBibleScreen projectId="long_test" onBack={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "LONG_PROJECT_STORAGE_ERROR");
    expect(alert.textContent).not.toContain("absolute");
    for (const name of ["Characters", "Locations", "Props", "Secrets", "Foreshadowing"]) expect(screen.getByRole("tab", { name })).toBeTruthy();
  });
});
