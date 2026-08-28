import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeLongProject } from "../api/testUtils.js";
import { LongEpisodeOutlineScreen } from "./LongEpisodeOutlineScreen.js";

const episode = (overrides: Record<string, unknown> = {}) => ({
  episodeNumber: 3,
  title: "돌아온 자",
  summary: "주인공이 고향에 돌아온다.",
  mainEvent: "성문 앞에서 옛 동료와 마주친다.",
  conflict: "동료는 이미 반대편에 서 있다.",
  cliffhanger: "성문이 닫힌다.",
  nextEpisodeHook: "닫힌 성문 안에서 불빛이 켜진다.",
  status: "outline_ready",
  approved: false,
  scriptRevision: 0,
  scriptHistoryCount: 0,
  ...overrides,
});

function stubFetchByRoute(
  routes: Record<string, unknown | unknown[]>,
  errorRoutes: Record<string, { status: number; body: unknown }> = {},
): ReturnType<typeof vi.fn> {
  const cursors: Record<string, number> = {};
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split("?")[0]!;
    const key = `${init?.method ?? "GET"} ${url}`;
    if (key in errorRoutes) return jsonResponse(errorRoutes[key]!.status, errorRoutes[key]!.body);
    if (!(key in routes)) throw new Error(`Unexpected fetch: ${key}`);
    const value = routes[key];
    if (!Array.isArray(value)) return jsonResponse(200, value);
    const index = Math.min(cursors[key] ?? 0, value.length - 1);
    cursors[key] = index + 1;
    return jsonResponse(200, value[index]);
  });
}

const OUTLINE_URL = "/long-projects/long_test/episodes/3/outline";
const EPISODE_URL = "/long-projects/long_test/episodes/3";

/** The PATCH response carries a whole LongProject, and the client validates it — a hand-rolled literal here
 *  would fail `isLongProject` and surface as CLIENT_MALFORMED_RESPONSE rather than the save this test is about. */
const project = makeLongProject({ id: "long_test" });

describe("LongEpisodeOutlineScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the plan the outline approval assigned to this episode", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episode() } }));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    await screen.findByDisplayValue("돌아온 자");
    expect(screen.getByDisplayValue("주인공이 고향에 돌아온다.")).toBeTruthy();
    expect(screen.getByDisplayValue("닫힌 성문 안에서 불빛이 켜진다.")).toBeTruthy();
  });

  it("sends only the fields that actually changed, since the server rejects blank values", async () => {
    const fetchMock = stubFetchByRoute({
      [`GET ${EPISODE_URL}`]: { episode: episode() },
      [`PATCH ${OUTLINE_URL}`]: { project, episode: episode({ summary: "주인공이 고향에 돌아오지만 아무도 알아보지 못한다." }) },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const summary = await screen.findByDisplayValue("주인공이 고향에 돌아온다.");
    fireEvent.change(summary, { target: { value: "주인공이 고향에 돌아오지만 아무도 알아보지 못한다." } });
    fireEvent.click(screen.getByRole("button", { name: "이 회차 내용 저장" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === OUTLINE_URL && (init as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url, init]) => String(url) === OUTLINE_URL && (init as RequestInit | undefined)?.method === "PATCH")! as [string, RequestInit];
    // Not the whole form — one key, the one that was edited.
    expect(JSON.parse(String(init.body))).toEqual({ outline: { summary: "주인공이 고향에 돌아오지만 아무도 알아보지 못한다." } });
  });

  it("keeps a blanked field from reaching the server, and names the field in the message", async () => {
    const fetchMock = stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episode() } });
    vi.stubGlobal("fetch", fetchMock);
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const conflict = await screen.findByDisplayValue("동료는 이미 반대편에 서 있다.");
    fireEvent.change(conflict, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "이 회차 내용 저장" }));

    expect((await screen.findByTestId("episode-outline-validation-error")).textContent).toContain("갈등");
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === OUTLINE_URL && (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("disables editing once this episode's script work has started, and says why", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episode({ status: "script_review", scriptRevision: 1 }) } }));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const title = await screen.findByDisplayValue("돌아온 자");
    expect(title).toBeDisabled();
    expect(screen.getByTestId("episode-outline-locked").textContent).toContain("다른 회차는");
    expect(screen.getByRole("button", { name: "이 회차 내용 저장" })).toBeDisabled();
  });

  it("explains the conflict in this screen's own terms when the server refuses the edit", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute(
      { [`GET ${EPISODE_URL}`]: { episode: episode() } },
      { [`PATCH ${OUTLINE_URL}`]: { status: 409, body: { code: "LONG_EPISODE_TIMELINE_NOT_ALLOWED", message: "Timeline edits require draft-only Episodes." } } },
    ));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const title = await screen.findByDisplayValue("돌아온 자");
    fireEvent.change(title, { target: { value: "돌아온 자들" } });
    fireEvent.click(screen.getByRole("button", { name: "이 회차 내용 저장" }));

    // The shared message for this code also talks about archiving the last episode, which has nothing to do
    // with editing a plan — this screen says the part that is actually true here.
    const failure = await screen.findByTestId("episode-outline-error");
    expect(failure.textContent).toContain("대본 작업이 시작돼서");
    expect(failure.textContent).not.toContain("보관");
  });

  it("makes you save before leaving for the script, so an unsaved plan is not silently dropped", async () => {
    const onOpenScript = vi.fn();
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episode() } }));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} onOpenScript={onOpenScript} />);

    const goToScript = await screen.findByRole("button", { name: "이 회차 대본으로 이동" });
    fireEvent.click(goToScript);
    expect(onOpenScript).toHaveBeenCalledWith("long_test", 3);

    fireEvent.change(screen.getByDisplayValue("돌아온 자"), { target: { value: "돌아온 자들" } });
    expect(screen.getByRole("button", { name: "먼저 저장해 주세요" })).toBeDisabled();
  });

  it("shows a load failure instead of an empty form", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({}, { [`GET ${EPISODE_URL}`]: { status: 404, body: { code: "LONG_EPISODE_NOT_FOUND", message: "not found" } } }));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const failure = await screen.findByTestId("episode-outline-error");
    expect(failure.getAttribute("data-error-code")).toBe("LONG_EPISODE_NOT_FOUND");
    expect(screen.queryByRole("button", { name: "이 회차 내용 저장" })).toBeNull();
  });

  // The title is built from the work's title at outline-approval time and never follows a later rename. That is
  // correct — it is the Episode's own data, and a rename must not overwrite what someone edited here. What was
  // missing is the screen saying so: an old work title with no explanation reads as the app being stale.
  it("says where the Episode title came from and that a rename will not update it", async () => {
    vi.stubGlobal("fetch", stubFetchByRoute({ [`GET ${EPISODE_URL}`]: { episode: episode() } }));
    render(<LongEpisodeOutlineScreen projectId="long_test" episodeNumber={3} onBack={() => {}} />);

    const hint = await screen.findByText(/회차 개요를 승인한 시점의 작품 제목/);
    expect(hint.textContent).toContain("따라가지 않");
    // The way out is named, because "it will not update" alone leaves a person with nothing to do.
    expect(hint.textContent).toContain("여기서 고쳐");
  });
});
