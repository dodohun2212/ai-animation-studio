import { vi } from "vitest";
import {
  API_ROUTES,
  WorkflowState,
  type Asset,
  type LongEpisodeOutline,
  type LongProject,
  type LongProjectSettings,
  type LongProjectSummary,
  type Project,
  type ProjectAssetMapping,
  type ProjectAssetMappingReview,
  type ProviderCredentialStatus,
} from "@ai-animation-studio/shared";

/** Minimal fake `Response` for mocking `fetch` in tests — no real network involved. */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Simulates a response whose body is not valid JSON. */
/**
 * A fetch stub that answers by route instead of by call order.
 *
 * Three times now a screen has gained one request and taken a pile of unrelated tests with it: every
 * `mockResolvedValueOnce` after the new one shifts by a place, and a test that meant to check a recovery ends
 * up asserting against a progress poll. Assertions were moved to route names after the second time; this is
 * the other half, because the *responses* were still positional.
 *
 * Keys are `"METHOD /url-suffix"` and the longest matching suffix wins, so `/generations/job` and
 * `/generations/job/review` can both be named without either shadowing the other. An unmatched request throws
 * with its URL — a request nobody planned for should be loud, not quietly answered with someone else's body.
 *
 * A route whose value is `sequence([...])` answers those bodies in order and then repeats the last one, so a
 * poll that must read "running" and then "succeeded" is still expressible. That is the one thing call-order
 * mocks did better, and without it a test that needs it has to keep the fragile style.
 */
const SEQUENCE = Symbol("stub-route-sequence");
interface RouteSequence { [SEQUENCE]: true; next(): unknown }
const isSequence = (value: unknown): value is RouteSequence =>
  Boolean(value) && typeof value === "object" && SEQUENCE in (value as Record<symbol, unknown>);

/** Successive answers for one route; the last one repeats once the list runs out. */
export function sequence(bodies: readonly unknown[]): unknown {
  let index = 0;
  return {
    [SEQUENCE]: true,
    next: () => bodies[Math.min(index++, bodies.length - 1)],
  } satisfies RouteSequence;
}

const STATUS = Symbol("stub-route-status");
interface RouteStatus { [STATUS]: true; status: number; body: unknown }
const isStatus = (value: unknown): value is RouteStatus =>
  Boolean(value) && typeof value === "object" && STATUS in (value as Record<symbol, unknown>);

/**
 * One answer with a status other than 200 — usable on its own or as an entry inside `sequence`.
 *
 * `errorRoutes` fixes a whole route as failing, which cannot express the case this exists for: a paid
 * submission that is refused and then succeeds when the person presses again. That is a real sequence in this
 * app, and a test tool that cannot say it sends the next person back to call-order chains — which is the
 * fragility this whole helper was written to end.
 */
export function withStatus(status: number, body: unknown): unknown {
  return { [STATUS]: true, status, body } satisfies RouteStatus;
}

/**
 * Answers a few named routes itself and hands everything else to an existing mock.
 *
 * For the case where a screen gains a request that a pile of older tests have no opinion about: a section
 * added to a page fetches its own data on mount, and every call-order chain behind it shifts by one. Rewriting
 * dozens of tests to say "and also this" would bury what each of them is actually about, so the new request is
 * taken out of the sequence instead of being threaded through it.
 *
 * `routes` uses the same `"METHOD /url-suffix"` keys as `stubFetchByRoute`. Anything unmatched goes to
 * `fallback` untouched, so the tests' own sequences are exactly as they were.
 */
export function answerOutOfBand(routes: Record<string, unknown>, fallback: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
  const own = stubFetchByRoute(routes);
  const keys = Object.keys(routes);
  type AnyFetch = (...args: unknown[]) => Promise<Response>;
  // Arguments are forwarded exactly as they arrived, count included: a test asserting
  // `toHaveBeenCalledWith("/assets")` fails against a two-argument call, so passing an explicit `undefined`
  // for a missing init would change what the underlying mock saw.
  return vi.fn(async (...args: unknown[]) => {
    const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const mine = keys.some((key) => {
      const [keyMethod, ...rest] = key.split(" ");
      return keyMethod === method && url.endsWith(rest.join(" "));
    });
    return (mine ? own as unknown as AnyFetch : fallback as unknown as AnyFetch)(...args);
  });
}

export function stubFetchByRoute(
  routes: Record<string, unknown>,
  errorRoutes: Record<string, { status: number; body: unknown }> = {},
): ReturnType<typeof vi.fn> {
  const match = (keys: string[], method: string, url: string): string | undefined =>
    keys.filter((key) => {
      const [keyMethod, ...rest] = key.split(" ");
      return keyMethod === method && url.endsWith(rest.join(" "));
    }).sort((left, right) => right.length - left.length)[0];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const failing = match(Object.keys(errorRoutes), method, url);
    if (failing) return jsonResponse(errorRoutes[failing]!.status, errorRoutes[failing]!.body);
    const hit = match(Object.keys(routes), method, url);
    if (!hit) throw new Error(`Unexpected fetch: ${method} ${url}`);
    const answer = isSequence(routes[hit]) ? (routes[hit] as RouteSequence).next() : routes[hit];
    if (isStatus(answer)) return jsonResponse(answer.status, answer.body);
    return jsonResponse(200, answer);
  });
}

export function nonJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  } as Response;
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "sample_project",
    topic: "우주를 여행하는 고양이",
    projectType: "short_project",
    workflowState: WorkflowState.Ready,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    aspectRatio: "9:16",
    narrationAvailable: false,
    scenes: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

export function makeProviderStatus(overrides: Partial<ProviderCredentialStatus> = {}): ProviderCredentialStatus {
  return {
    provider: "openai",
    configured: false,
    connected: false,
    maskedValue: null,
    ...overrides,
  };
}

export function makeAsset(overrides: Partial<Asset> = {}): Asset {
  const assetId = overrides.assetId ?? "ASSET-GENERAL-000000000001";
  const imageAvailable = overrides.imageAvailable ?? true;
  return {
    assetId,
    assetType: "general_reference",
    displayName: "샘플 에셋",
    description: "설명",
    originalFilename: "sample.png",
    contentSha256: "a".repeat(64),
    imageAvailable,
    contentUrl: imageAvailable ? API_ROUTES.assetContent(assetId) : null,
    tags: [],
    aliases: [],
    enabled: true,
    approved: false,
    faceBaseline: false,
    characterKey: null,
    version: 1,
    versions: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    notes: "",
    legacyAssetIds: [],
    status: "manual",
    sourceProjectId: "_asset_library_manual",
    sourceSceneNumber: null,
    referenceImages: [],
    referenceRoles: [],
    isFolder: false,
    parentFolderId: "",
    childAssetIds: [],
    thumbnailAssetId: "",
    role: "",
    sortOrder: 0,
    ...overrides,
  };
}

/**
 * A Folder Asset that satisfies the frontend's own `isAsset()` folder invariant (assetsApi.ts): no digest, no
 * image, no versions, no reference images. `makeAsset({ isFolder: true })` alone does NOT — it keeps the
 * non-folder defaults (a real digest, `imageAvailable: true`), producing an Asset the response validator
 * rejects as malformed, which surfaces in a test as a confusing CLIENT_MALFORMED_RESPONSE banner instead of
 * the data you thought you stubbed. Use this whenever a fixture needs to be a Folder.
 */
export function makeAssetFolder(overrides: Partial<Asset> = {}): Asset {
  return makeAsset({
    isFolder: true,
    imageAvailable: false,
    contentSha256: "",
    contentUrl: null,
    versions: [],
    referenceImages: [],
    ...overrides,
  });
}

export function makeMapping(overrides: Partial<ProjectAssetMapping> = {}): ProjectAssetMapping {
  return {
    mappingId: "MAP-000000000001",
    projectId: "sample_project",
    assetId: "ASSET-GENERAL-000000000001",
    enabled: true,
    usageRole: "character",
    sceneScope: { kind: "all" },
    assignmentSource: "manual",
    confidence: null,
    matchReason: "manual_assignment",
    status: "confirmed",
    userConfirmed: true,
    versionPolicy: "pinned_version",
    pinnedVersion: 1,
    candidateOnly: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    snapshot: null,
    selectedChildAssetIds: [],
    ...overrides,
  };
}

export function makeLongProjectSettings(overrides: Partial<LongProjectSettings> = {}): LongProjectSettings {
  return {
    title: "우주 방랑자",
    logline: "떠도는 항해사가 고향 별을 되찾는다.",
    overview: "",
    genre: "SF",
    tone: "진지함",
    theme: "귀환",
    episodeCount: 3,
    episodeDurationSeconds: 30,
    sceneCount: 6,
    clipDurationSeconds: 5,
    aspectRatio: "9:16",
    audience: "",
    notes: "",
    startingState: "",
    midpoint: "",
    endingDirection: "",
    storyFlowSummary: "",
    narrationEnabled: false,
    subtitlesEnabled: false,
    ...overrides,
  };
}

export function makeLongProjectSummary(overrides: Partial<LongProjectSummary> = {}): LongProjectSummary {
  return {
    id: "long_sample",
    title: "우주 방랑자",
    logline: "떠도는 항해사가 고향 별을 되찾는다.",
    episodeCount: 3,
    outlineStatus: "planned",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

export function makeLongEpisodeOutline(overrides: Partial<LongEpisodeOutline> = {}): LongEpisodeOutline {
  const episodeNumber = overrides.episodeNumber ?? 1;
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    summary: "",
    mainEvent: "",
    conflict: "",
    cliffhanger: "",
    nextEpisodeHook: "",
    status: "planned",
    ...overrides,
  };
}

export function makeLongProject(overrides: Partial<LongProject> = {}): LongProject {
  const summary = makeLongProjectSummary(overrides);
  return {
    ...summary,
    settings: makeLongProjectSettings({
      title: summary.title,
      logline: summary.logline,
      episodeCount: summary.episodeCount,
    }),
    storyBible: { basic: {}, world: {} },
    episodes: Array.from({ length: summary.episodeCount }, (_, index) => makeLongEpisodeOutline({ episodeNumber: index + 1 })),
    ...overrides,
  };
}

export function makeReview(overrides: Partial<ProjectAssetMappingReview> = {}): ProjectAssetMappingReview {
  return {
    projectId: "sample_project",
    mappingRevision: 0,
    scriptRevision: 0,
    scriptFingerprint: "",
    status: "waiting",
    approvedAt: null,
    approvedBy: null,
    textOnlyConfirmed: false,
    legacyConfirmed: false,
    reviewedScenes: [],
    ...overrides,
  };
}
