import { useEffect, useRef, useState } from "react";
import type { LongProject, Project } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { getProject } from "./api/projectsApi.js";

import heroRing from "./assets/hero-ring.png";
import heroLandscape from "./assets/hero-landscape.png";

import { CreateProjectForm } from "./components/CreateProjectForm.js";
import { ProjectDetail } from "./components/ProjectDetail.js";
import { ProjectList } from "./components/ProjectList.js";
import { ProviderSettingsScreen } from "./components/ProviderSettingsScreen.js";
import { AssetLibraryScreen } from "./components/AssetLibraryScreen.js";
import { VideoLibraryScreen } from "./components/VideoLibraryScreen.js";
import { PhotoCardScreen } from "./components/PhotoCardScreen.js";
import { AudioLibraryScreen } from "./components/AudioLibraryScreen.js";
import { InstagramPostScreen } from "./components/InstagramPostScreen.js";
import { MappingReviewScreen } from "./components/MappingReviewScreen.js";
import { episodeMappingApi, projectMappingApi } from "./api/mappingsApi.js";
import { ShortProjectSettingsScreen } from "./components/ShortProjectSettingsScreen.js";
import { StoryPromptScreen } from "./components/StoryPromptScreen.js";
import { ImageGenerationScreen } from "./components/ImageGenerationScreen.js";
import { VideoPromptPreviewScreen } from "./components/VideoPromptPreviewScreen.js";
import { VideoWorkflowScreen } from "./components/VideoWorkflowScreen.js";
import { VideoMergeScreen } from "./components/VideoMergeScreen.js";
import { CreateLongProjectForm } from "./components/CreateLongProjectForm.js";
import { LongProjectDetail } from "./components/LongProjectDetail.js";
import { LongProjectList } from "./components/LongProjectList.js";
import { LongProjectSettingsScreen } from "./components/LongProjectSettingsScreen.js";
import { LongProjectOutlineScreen } from "./components/LongProjectOutlineScreen.js";
import { LongEpisodeOutlineScreen } from "./components/LongEpisodeOutlineScreen.js";
import { LongEpisodeScriptScreen } from "./components/LongEpisodeScriptScreen.js";
import { LongEpisodeImageGenerationScreen } from "./components/LongEpisodeImageGenerationScreen.js";
import { LongEpisodeVideoWorkflowScreen } from "./components/LongEpisodeVideoWorkflowScreen.js";
import { LongEpisodeVideoMergeScreen } from "./components/LongEpisodeVideoMergeScreen.js";
import { LongEpisodeNarrationReviewScreen } from "./components/LongEpisodeNarrationReviewScreen.js";
import { LongEpisodeContinuityScreen } from "./components/LongEpisodeContinuityScreen.js";
import { LongEpisodeSettingsScreen } from "./components/LongEpisodeSettingsScreen.js";
import { ArchiveScreen } from "./components/ArchiveScreen.js";
import { WorkflowGuideScreen } from "./components/WorkflowGuideScreen.js";
import { NarrationReviewScreen } from "./components/NarrationReviewScreen.js";
import type { ResumeTarget } from "./utils/resumeTarget.js";
import { SceneEditScreen } from "./components/SceneEditScreen.js";
import { PHOTO_CARD_SKIPPED_SCREEN_NAMES, PHOTO_CARD_STEPS } from "./utils/photoCardSteps.js";

type Screen =
  | { name: "list" }
  | { name: "create" }
  | { name: "detail"; projectId: string }
  | { name: "mappingReview"; projectId: string }
  | { name: "settings"; projectId: string; justCreated?: boolean }
  | { name: "storyPrompt"; projectId: string }
  | { name: "imageGeneration"; projectId: string }
  | { name: "narrationReview"; projectId: string }
  | { name: "sceneEdit"; projectId: string }
  | { name: "videoPreview"; projectId: string }
  | { name: "videoWorkflow"; projectId: string; jobId: string }
  | { name: "videoMerge"; projectId: string }
  | { name: "providerSettings" }
  | { name: "assets"; initialQuery?: string }
  | { name: "videoLibrary" }
  | { name: "audioLibrary" }
  | { name: "photoCard" }
  | { name: "instagramPost" }
  | { name: "archive" }
  | { name: "workflowGuide" }
  | { name: "longList" }
  | { name: "longCreate" }
  | { name: "longDetail"; projectId: string }
  | { name: "longSettings"; projectId: string }
  | { name: "longOutline"; projectId: string }
  | { name: "longEpisodeOutline"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeScript"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeMappingReview"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeImageGeneration"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeVideoWorkflow"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeVideoMerge"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeNarrationReview"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeContinuity"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeSettings"; projectId: string; episodeNumber: number };

/**
 * Which fields each screen carries, so the address bar can hold them and a reload can put them back.
 *
 * Screen position used to live only in React state: every refresh dropped it and the app reopened on the
 * project list — mid-task, on a screen someone had clicked four times to reach.
 *
 * Typed as a total map over `Screen["name"]`, which is the point: adding a screen without a line here is a
 * type error, not a screen that silently stops surviving reload. Encoding is mechanical rather than a table of
 * hand-written paths, so there is nothing to keep in agreement.
 *
 * `justCreated` is deliberately absent. It marks the one moment just after creation and changes the finish
 * button's wording; restoring it from a URL would show a first-run affordance on a project made last week.
 */
type ScreenParam = "projectId" | "episodeNumber" | "jobId" | "initialQuery";
const OPTIONAL_PARAMS: ReadonlySet<ScreenParam> = new Set<ScreenParam>(["initialQuery"]);
const SCREEN_PARAMS: Record<Screen["name"], readonly ScreenParam[]> = {
  list: [], create: [], providerSettings: [], videoLibrary: [], audioLibrary: [], instagramPost: [], photoCard: [],
  archive: [], workflowGuide: [], longList: [], longCreate: [],
  assets: ["initialQuery"],
  detail: ["projectId"], mappingReview: ["projectId"], settings: ["projectId"], storyPrompt: ["projectId"],
  imageGeneration: ["projectId"], narrationReview: ["projectId"], sceneEdit: ["projectId"],
  videoPreview: ["projectId"], videoMerge: ["projectId"],
  videoWorkflow: ["projectId", "jobId"],
  longDetail: ["projectId"], longSettings: ["projectId"], longOutline: ["projectId"],
  longEpisodeOutline: ["projectId", "episodeNumber"],
  longEpisodeScript: ["projectId", "episodeNumber"],
  longEpisodeMappingReview: ["projectId", "episodeNumber"],
  longEpisodeImageGeneration: ["projectId", "episodeNumber"],
  longEpisodeVideoWorkflow: ["projectId", "episodeNumber"],
  longEpisodeVideoMerge: ["projectId", "episodeNumber"],
  longEpisodeNarrationReview: ["projectId", "episodeNumber"],
  longEpisodeContinuity: ["projectId", "episodeNumber"],
  longEpisodeSettings: ["projectId", "episodeNumber"],
};

const HOME: Screen = { name: "list" };

export function hashFromScreen(screen: Screen): string {
  const params = new URLSearchParams();
  for (const key of SCREEN_PARAMS[screen.name]) {
    const value = (screen as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `#/${screen.name}?${query}` : `#/${screen.name}`;
}

/**
 * A URL is typed by hand, edited, bookmarked and then followed months later — so every part of it is checked,
 * and anything that does not resolve falls back to the project list rather than rendering a screen with an
 * `undefined` where a project id belongs. A bad address is a wrong page, never a broken one.
 */
export function screenFromHash(hash: string): Screen {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return HOME;
  const [name = "", query] = raw.split("?", 2);
  if (!Object.prototype.hasOwnProperty.call(SCREEN_PARAMS, name)) return HOME;
  const screenName = name as Screen["name"];
  const params = new URLSearchParams(query ?? "");
  const built: Record<string, unknown> = { name: screenName };
  for (const key of SCREEN_PARAMS[screenName]) {
    const value = params.get(key);
    if (value === null || value === "") {
      if (OPTIONAL_PARAMS.has(key)) continue;
      return HOME;
    }
    if (key === "episodeNumber") {
      const episodeNumber = Number(value);
      // Episodes are counted from 1. A zero, a negative or "abc" would reach a screen that fetches by number
      // and render its own storage error — a worse answer than simply not going there.
      if (!Number.isInteger(episodeNumber) || episodeNumber < 1) return HOME;
      built[key] = episodeNumber;
      continue;
    }
    built[key] = value;
  }
  return built as Screen;
}

const LONG_PROJECT_SCREEN_NAMES = new Set<Screen["name"]>([
  "longDetail", "longSettings", "longOutline",
  "longEpisodeOutline", "longEpisodeScript", "longEpisodeMappingReview", "longEpisodeImageGeneration",
  "longEpisodeVideoWorkflow", "longEpisodeVideoMerge", "longEpisodeNarrationReview", "longEpisodeContinuity",
  "longEpisodeSettings",
]);

const SHORT_PROJECT_SCREEN_NAMES = new Set<Screen["name"]>([
  "list", "create", "detail", "mappingReview", "settings", "storyPrompt",
  "imageGeneration", "narrationReview", "sceneEdit", "videoPreview", "videoWorkflow", "videoMerge",
]);

type NavIconName = "home" | "long" | "library" | "quote" | "film" | "music" | "share" | "archive" | "workflow" | "settings";

function NavIcon({ name }: { name: NavIconName }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 flex-shrink-0",
    "aria-hidden": true,
  };
  switch (name) {
    case "home":
      return (
        <svg {...shared}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
        </svg>
      );
    case "long":
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    // Its own glyph rather than the library one it used to share: a nav column is scanned by shape before it
    // is read, and two entries drawn identically make the reader fall back to reading every label.
    case "quote":
      return (
        <svg {...shared}>
          <path d="M9.5 6.5C7 7.5 5.5 9.5 5.5 12v5.5h5V12H8c0-1.6.6-2.8 1.5-3.4z" />
          <path d="M18 6.5c-2.5 1-4 3-4 5.5v5.5h5V12h-2.5c0-1.6.6-2.8 1.5-3.4z" />
        </svg>
      );
    case "library":
      return (
        <svg {...shared}>
          <path d="M4 19V5a1 1 0 0 1 1-1h4v16H5a1 1 0 0 1-1-1Z" />
          <path d="M9 4h6v16H9z" />
          <path d="M15 5.3 18.4 6a1 1 0 0 1 .8 1.2L17 20l-3.4-.6" />
        </svg>
      );
    case "film":
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
        </svg>
      );
    case "music":
      return (
        <svg {...shared}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "share":
      return (
        <svg {...shared}>
          <path d="M21.5 3.5 10.8 14.2" />
          <path d="M21.5 3.5 14.7 21a.6.6 0 0 1-1.1.05l-2.8-6.85-6.85-2.8a.6.6 0 0 1 .05-1.1Z" />
        </svg>
      );
    case "archive":
      return (
        <svg {...shared}>
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
          <path d="M10 13h4" />
        </svg>
      );
    case "workflow":
      return (
        <svg {...shared}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path d="M8.5 6h4a2 2 0 0 1 2 2v1.5M14.5 14.5V16a2 2 0 0 1-2 2h-4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a7.9 7.9 0 0 0 0-3l1.9-1.5-2-3.4-2.3.6a7.9 7.9 0 0 0-2.6-1.5L14 2h-4l-.4 2.7a7.9 7.9 0 0 0-2.6 1.5l-2.3-.6-2 3.4L4.6 10.5a7.9 7.9 0 0 0 0 3L2.7 15l2 3.4 2.3-.6a7.9 7.9 0 0 0 2.6 1.5L10 22h4l.4-2.7a7.9 7.9 0 0 0 2.6-1.5l2.3.6 2-3.4-1.9-1.5Z" />
        </svg>
      );
  }
}

type NavSection = "short" | "long" | "assets" | "videoLibrary" | "audioLibrary" | "photoCard" | "instagramPost" | "archive" | "workflowGuide" | "providerSettings";

function navSectionFor(name: Screen["name"]): NavSection | null {
  if (name === "assets") return "assets";
  if (name === "videoLibrary") return "videoLibrary";
  if (name === "audioLibrary") return "audioLibrary";
  if (name === "photoCard") return "photoCard";
  if (name === "instagramPost") return "instagramPost";
  if (name === "archive") return "archive";
  if (name === "workflowGuide") return "workflowGuide";
  if (name === "providerSettings") return "providerSettings";
  if (LONG_PROJECT_SCREEN_NAMES.has(name) || name === "longList" || name === "longCreate") return "long";
  if (SHORT_PROJECT_SCREEN_NAMES.has(name)) return "short";
  return null;
}

/** Always visible so a section (이미지 보관함, API 설정, 장기 프로젝트) is never more than one click away, no matter how deep the current screen is. */
function NavBar({ current, onNavigate }: { current: Screen["name"]; onNavigate: (screen: Screen) => void }) {
  const section = navSectionFor(current);
  const items: { key: NavSection; icon: NavIconName; label: string; target: Screen }[] = [
    { key: "short", icon: "home", label: "단기 프로젝트", target: { name: "list" } },
    { key: "long", icon: "long", label: "장기 프로젝트", target: { name: "longList" } },
    { key: "assets", icon: "library", label: "이미지 보관함", target: { name: "assets" } },
    { key: "videoLibrary", icon: "film", label: "영상 보관함", target: { name: "videoLibrary" } },
    { key: "audioLibrary", icon: "music", label: "음원 보관함", target: { name: "audioLibrary" } },
    { key: "photoCard", icon: "quote", label: "명언 카드", target: { name: "photoCard" } },
    { key: "instagramPost", icon: "share", label: "게시물 준비", target: { name: "instagramPost" } },
    // Not "보관함": three entries above it are libraries and this one is not — it is where a project goes to be recovered or destroyed.
    { key: "archive", icon: "archive", label: "보관한 프로젝트", target: { name: "archive" } },
    { key: "workflowGuide", icon: "workflow", label: "작업 워크플로우", target: { name: "workflowGuide" } },
    { key: "providerSettings", icon: "settings", label: "API 설정", target: { name: "providerSettings" } },
  ];
  return (
    <nav aria-label="주 메뉴" className="mt-6 flex flex-col gap-1 border-b border-white/10 pb-6">
      {items.map((item) => {
        const active = section === item.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${active ? "bg-violet-500/15 text-white" : "text-violet-300"}`}
            onClick={() => onNavigate(item.target)}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function tab(current: Screen["name"], name: Screen["name"], label: string, onClick: () => void) {
  const active = current === name;
  return (
    <button
      key={name}
      type="button"
      aria-current={active ? "page" : undefined}
      className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${active ? "bg-violet-500 text-white" : "text-violet-300 underline"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * A second-level workspace nav for one long-form project (and, once inside one, one Episode),
 * so every sibling step is a direct jump instead of a walk back through LongProjectDetail each
 * time — the project-level cohesion Python's single Story Studio workspace had.
 */
function LongWorkspaceNav({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  if (!LONG_PROJECT_SCREEN_NAMES.has(screen.name) || !("projectId" in screen)) return null;
  const projectId = screen.projectId;
  const episodeNumber = "episodeNumber" in screen ? screen.episodeNumber : undefined;
  return (
    <nav aria-label="장편 프로젝트 작업공간" className="mt-4 flex flex-col items-start gap-1 border-b border-white/10 pb-4">
      {tab(screen.name, "longDetail", "작품 한눈에 보기", () => onNavigate({ name: "longDetail", projectId }))}
      {tab(screen.name, "longSettings", "작품 기본 설정", () => onNavigate({ name: "longSettings", projectId }))}
      {/* 등장인물·설정집 is gone. Its three remaining tabs (캐릭터·배경·소품) named folders that the script
          prompt never received — reference pictures reach generation through 참고 이미지 연결, per Episode, and
          always did. The two halves that the prompt does read, 세계관 설명 and 비밀·복선, moved into 작품 기본
          설정 above, which is also where the tab order now puts them: the settings screen is read when the
          Episode outline is generated and again for every Episode script, so it belongs before 회차 나누기. */}
      {tab(screen.name, "longOutline", "회차 나누기(AI)", () => onNavigate({ name: "longOutline", projectId }))}
      {episodeNumber !== undefined && (
        <>
          <span className="mx-1 text-sm text-slate-500">·</span>
          <span className="text-sm text-slate-400">{episodeNumber}화</span>
          {tab(screen.name, "longEpisodeOutline", "이 회차 내용", () => onNavigate({ name: "longEpisodeOutline", projectId, episodeNumber }))}
          {/* Before 장면 대본 on purpose: these two numbers go into the script prompt, so they are chosen
              before the script exists — and once it does, this screen's whole job is to say why they are fixed. */}
          {tab(screen.name, "longEpisodeSettings", "이 회차 설정", () => onNavigate({ name: "longEpisodeSettings", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeScript", "장면 대본", () => onNavigate({ name: "longEpisodeScript", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeMappingReview", "참고 이미지 연결", () => onNavigate({ name: "longEpisodeMappingReview", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeImageGeneration", "장면 이미지", () => onNavigate({ name: "longEpisodeImageGeneration", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeVideoWorkflow", "장면 영상", () => onNavigate({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeVideoMerge", "최종 영상 합치기", () => onNavigate({ name: "longEpisodeVideoMerge", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeContinuity", "이어쓰기 메모", () => onNavigate({ name: "longEpisodeContinuity", projectId, episodeNumber }))}
        </>
      )}
    </nav>
  );
}

type ShortPipelineStepName =
  | "storyPrompt"
  | "mappingReview"
  | "imageGeneration"
  | "videoPreview"
  | "videoWorkflow"
  | "videoMerge";

/**
 * Named by what happens at each step. Three of these had "영상" in them and one was called "워크플로우" — a
 * category word, not a step — so the last three read as one thing split into three for no visible reason.
 * They are actually before / during / after the paid Runway call, and the names now say that.
 */
const SHORT_PROJECT_PIPELINE: { name: ShortPipelineStepName; label: string }[] = [
  { name: "storyPrompt", label: "대본" },
  { name: "mappingReview", label: "참고 이미지 연결" },
  { name: "imageGeneration", label: "장면 이미지" },
  { name: "videoPreview", label: "영상 보내기 전 확인" },
  { name: "videoWorkflow", label: "영상 만들어지는 중" },
  { name: "videoMerge", label: "최종 영상 합치기" },
];

const SHORT_PIPELINE_CONTEXT_SCREENS = new Set<Screen["name"]>([
  "detail", "settings", "storyPrompt", "mappingReview", "imageGeneration",
  "videoPreview", "videoWorkflow", "videoMerge",
]);

/**
 * A 명언 카드 is not a short story, and the pipeline above is the story's.
 *
 * `photo-card.service.ts` creates one already at `VideosApproved`: the picture is copied from the Library, the
 * scene record is written, and no provider is ever called. So a card has not "finished" 대본 · 참고 이미지
 * 연결 · 장면 이미지 · 영상 만들기 — it never had them. The six-step list showed all six filled in anyway, and
 * clicking one landed on a screen whose gate then blamed the person's input: 캡틴D pressed 연결 다 했음 on a
 * card and got "입력 내용을 확인해 주세요" for a fingerprint no one had ever been asked to produce.
 *
 * Two steps are what a card actually has, and they are both real: choose the subtitle layout and music and
 * merge, then publish.
 *
 * 🔴 Both lists moved to utils/photoCardSteps.ts. The project detail screen needs the same answers — it was
 * still offering 장면 편집 and 내레이션 확인 for a card, buttons whose only destination is the notice this
 * router renders — and a second handwritten copy there is how the two would drift apart.
 *
 * The typed shapes stay here, and that is the point: assigning the plain names into `Screen["name"]` is where
 * the compiler checks each one is a real screen. Renaming a screen breaks these two lines instead of quietly
 * emptying the gate.
 */
const PHOTO_CARD_PIPELINE: { name: Screen["name"]; label: string }[] = [...PHOTO_CARD_STEPS];
const PHOTO_CARD_SKIPPED_SCREENS = new Set<Screen["name"]>(PHOTO_CARD_SKIPPED_SCREEN_NAMES);

/** Merged and published is the only card state past the first step; everything else is still at it. */
const PHOTO_CARD_REACH: Partial<Record<WorkflowState, number>> = {
  [WorkflowState.Completed]: 1,
};

// videoWorkflow carries a required jobId we don't always have on hand (e.g. jumping in from
// storyPrompt) — fall back to detail, which already knows how to resume into the right job.
function shortPipelineTarget(stepName: ShortPipelineStepName, projectId: string, currentScreen: Screen): Screen {
  switch (stepName) {
    case "storyPrompt": return { name: "storyPrompt", projectId };
    case "mappingReview": return { name: "mappingReview", projectId };
    case "imageGeneration": return { name: "imageGeneration", projectId };
    case "videoPreview": return { name: "videoPreview", projectId };
    case "videoMerge": return { name: "videoMerge", projectId };
    case "videoWorkflow":
      return currentScreen.name === "videoWorkflow" ? currentScreen : { name: "detail", projectId };
  }
}

/**
 * How far the project itself has actually got, as an index into SHORT_PROJECT_PIPELINE. `-1` means nothing has
 * started. Several states share a step because they are phases of the same one (making images, images ready,
 * reviewing images are all "장면 이미지"). Failure states light nothing: whatever the run reached, it is not a
 * position the person can read progress from.
 */
const PIPELINE_REACH: Readonly<Record<WorkflowState, number>> = {
  [WorkflowState.Init]: -1,
  [WorkflowState.Ready]: 0,
  [WorkflowState.GeneratingStory]: 0,
  [WorkflowState.WaitingForAssetMappingReview]: 1,
  [WorkflowState.AssetMappingApproved]: 2,
  [WorkflowState.GeneratingImages]: 2,
  [WorkflowState.ImagesReady]: 2,
  [WorkflowState.ImagesReview]: 2,
  [WorkflowState.WaitingForVideoConfirmation]: 3,
  [WorkflowState.GeneratingVideos]: 4,
  [WorkflowState.Interrupted]: 4,
  [WorkflowState.VideosReady]: 4,
  [WorkflowState.ReviewingVideos]: 4,
  [WorkflowState.VideosApproved]: 5,
  [WorkflowState.Rendering]: 5,
  [WorkflowState.Completed]: 5,
  [WorkflowState.Failed]: -1,
  [WorkflowState.Cancelled]: -1,
};

/**
 * Where the project stands in the fixed short-project pipeline.
 *
 * The filled dots used to be derived from the screen being viewed, which meant simply clicking a step
 * "un-completed" everything after it and "completed" everything before it — the list answered "where am I
 * looking" while looking exactly like an answer to "how far have I got". Now the dots come from the project's
 * own workflow state and do not move when you navigate; the row you are viewing is marked separately.
 */
function ShortProjectPipeline({ screen, onNavigate, shell }: { screen: Screen; onNavigate: (screen: Screen) => void; shell: ShortProjectShell | null }) {
  const card = shell?.photoCard === true;
  // A card is reachable from its own two steps as well as the story ones it never had, so the bar stays up on
  // both sets — otherwise the way back disappears exactly where someone is most lost.
  const inContext = "projectId" in screen
    && (SHORT_PIPELINE_CONTEXT_SCREENS.has(screen.name) || (card && PHOTO_CARD_SKIPPED_SCREENS.has(screen.name)));
  const projectId = inContext ? (screen as { projectId: string }).projectId : null;
  // Unlit until the read lands, and unlit again if it failed: the dots say how far the project got, and
  // "not known" is not a distance.
  const steps = card ? PHOTO_CARD_PIPELINE : SHORT_PROJECT_PIPELINE;
  const reached = shell === null
    ? -1
    : card
      ? PHOTO_CARD_REACH[shell.workflowState] ?? 0
      : PIPELINE_REACH[shell.workflowState] ?? -1;

  if (!inContext || !projectId) return null;
  return (
    <nav aria-label={card ? "명언 카드 진행 단계" : "단기 프로젝트 진행 단계"} data-testid={card ? "photo-card-pipeline" : "short-project-pipeline"} className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-6">
      {steps.map((step, index) => {
        const viewing = step.name === screen.name;
        const done = index < reached;
        const inProgress = index === reached;
        return (
          <button
            key={step.name}
            type="button"
            aria-current={viewing ? "step" : undefined}
            data-step-state={done ? "done" : inProgress ? "current" : "upcoming"}
            onClick={() => onNavigate(card
              // 게시물 준비 is not a per-project screen — it picks the project itself — so a card's second step
              // is a plain jump rather than something shortPipelineTarget could address.
              ? (step.name === "instagramPost" ? { name: "instagramPost" } : { name: "videoMerge", projectId })
              : shortPipelineTarget(step.name as ShortPipelineStepName, projectId, screen))}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${viewing ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
          >
            <span
              aria-hidden="true"
              className={
                inProgress
                  ? "h-2.5 w-2.5 flex-shrink-0 rounded-full bg-violet-400 shadow-[0_0_0_4px_rgba(167,139,250,0.25)]"
                  : done
                    ? "h-2.5 w-2.5 flex-shrink-0 rounded-full bg-violet-300/70"
                    : "h-2.5 w-2.5 flex-shrink-0 rounded-full border border-slate-600"
              }
            />
            <span className={done || inProgress ? (viewing ? "font-medium text-white" : "text-slate-200") : viewing ? "font-medium text-slate-300" : "text-slate-500"}>
              {step.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The two facts the shell needs about the short project on screen, read once and shared.
 *
 * The pipeline used to fetch this for itself; the router now needs the same answer to decide whether a
 * story-only screen applies at all, and two fetches of one project is how two parts of a shell start
 * disagreeing about what it is.
 *
 * 🔴 `null` is "not known", never "not a card". A screen is only ever replaced on a definite answer — while
 * the read is in flight, or after it failed, every screen renders exactly as it did before. Hiding a real
 * screen on a guess is the more expensive mistake of the two.
 */
type ShortProjectShell = { workflowState: WorkflowState; photoCard: boolean };

function useShortProjectShell(screen: Screen): ShortProjectShell | null {
  const projectId = SHORT_PROJECT_SCREEN_NAMES.has(screen.name) && "projectId" in screen
    ? (screen as { projectId: string }).projectId
    : null;
  const [shell, setShell] = useState<ShortProjectShell | null>(null);
  useEffect(() => {
    if (!projectId) { setShell(null); return; }
    let cancelled = false;
    getProject(projectId)
      .then((response) => {
        if (cancelled) return;
        setShell({ workflowState: response.project.workflowState, photoCard: response.project.photoCard === true });
      })
      // Silent, and back to "not known": a failed read must leave the screens alone, not hide them.
      .catch(() => { if (!cancelled) setShell(null); });
    return () => { cancelled = true; };
    // Re-read on every screen change too: finishing a step is exactly what moves this, and the person lands
    // on another screen the moment it happens.
  }, [projectId, screen.name]);
  return shell;
}

/**
 * Said where the person arrived, not where they came from.
 *
 * A card can still reach these screens by an old link or the Back button. Rendering the story screen there is
 * what produced a gate refusing input nobody gave; rendering nothing would read as the app being broken.
 */
function PhotoCardStepNotice({ projectId, onOpenMerge }: { projectId: string; onOpenMerge: () => void }) {
  return (
    <section className="mt-8 max-w-2xl space-y-5" data-testid="photo-card-step-skipped">
      <h2 className="text-lg font-semibold text-slate-100">명언 카드에는 없는 단계입니다</h2>
      <p className="text-sm text-slate-300">
        명언 카드는 골라 둔 그림 한 장에 글귀를 얹는 것이라, 대본·참고 이미지·장면 이미지·영상 만들기를
        <span className="font-semibold text-slate-100"> 아예 거치지 않습니다</span>. 건너뛴 게 아니라 처음부터 없는 단계입니다.
      </p>
      <p className="text-sm text-slate-300">
        카드에서 하실 일은 둘입니다 — <span className="font-semibold text-slate-100">자막·음악을 정해 영상으로 만들고</span>, 게시하는 것.
      </p>
      <button
        type="button"
        data-testid="photo-card-step-skipped-merge"
        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
        onClick={onOpenMerge}
      >
        자막·음악 정하러 가기
      </button>
      <p className="text-xs text-slate-500" data-testid="photo-card-step-skipped-id">{projectId}</p>
    </section>
  );
}

function Sidebar({ screen, onNavigate, shell }: { screen: Screen; onNavigate: (screen: Screen) => void; shell: ShortProjectShell | null }) {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-slate-900 px-5 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-400">
        Prism Forge
      </p>
      <NavBar current={screen.name} onNavigate={onNavigate} />
      <LongWorkspaceNav screen={screen} onNavigate={onNavigate} />
      <ShortProjectPipeline screen={screen} onNavigate={onNavigate} shell={shell} />
    </aside>
  );
}

export function App() {
  /**
   * Screen position, kept in the address bar so a reload lands where the person was.
   *
   * It used to live only here, so every refresh dropped it and the app reopened on the project list — mid-task,
   * on a screen someone had clicked four times to reach. The two effects below keep state and address in step;
   * they settle rather than oscillate because encoding is canonical (a hand-typed address decodes, re-encodes
   * to its normal form, and the next pass finds the two equal).
   */
  const [screen, setScreen] = useState<Screen>(() => screenFromHash(window.location.hash));
  const shortProjectShell = useShortProjectShell(screen);
  /**
   * A story-only screen opened on a 명언 카드.
   *
   * Only ever true on a definite answer — see useShortProjectShell. The card gets the sentence instead of the
   * screen, which is what stops a gate built for a six-scene story from refusing input a card never had.
   */
  const photoCardSkippedScreen = shortProjectShell?.photoCard === true
    && PHOTO_CARD_SKIPPED_SCREENS.has(screen.name)
    && "projectId" in screen;
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [longListRefreshToken, setLongListRefreshToken] = useState(0);

  /**
   * Routes a resumeTarget to its screen. The same mapping ProjectDetail applies to its own 「이어서 진행하기」
   * button, expressed once here so a screen that offers the shortcut lands exactly where the project screen
   * would have sent the reader.
   */
  function resumeScreenFor(projectId: string, target: ResumeTarget): void {
    // Written out rather than spread from `target.screen`: Screen is a discriminated union, and a widened
    // `name` satisfies none of its members. Each case also documents that these six are the whole flow.
    switch (target.screen) {
      case "storyPrompt": setScreen({ name: "storyPrompt", projectId }); return;
      case "mappingReview": setScreen({ name: "mappingReview", projectId }); return;
      case "imageGeneration": setScreen({ name: "imageGeneration", projectId }); return;
      case "videoPreview": setScreen({ name: "videoPreview", projectId }); return;
      case "videoWorkflow": setScreen({ name: "videoWorkflow", projectId, jobId: target.jobId }); return;
      case "videoMerge": setScreen({ name: "videoMerge", projectId }); return;
    }
  }

  // Writing the hash is what creates the history entry, so Back walks the screens the person actually visited.
  useEffect(() => {
    const next = hashFromScreen(screen);
    if (window.location.hash !== next) { ourWrites.current.push(next); window.location.hash = next; }
  }, [screen]);

  /**
   * Back, Forward, and an address typed or pasted by hand all arrive here — but so does our own write above,
   * because setting `location.hash` fires this event too.
   *
   * Rebuilding the screen from our own address is lossy: the address deliberately carries only what identifies
   * a screen, so anything else on the screen object is dropped on the way back. `justCreated` is the one that
   * matters — it turns the first-run notice on right after a project is made, and the round trip switched it
   * off again before anyone saw it. So an event whose address already matches the screen we are showing is
   * ours and is ignored; a differing one came from outside and is obeyed.
   */
  const ourWrites = useRef<string[]>([]);
  useEffect(() => {
    function onHashChange(): void {
      // Our own writes come back as events, in the order they were made, and they are echoes rather than
      // navigation. Comparing against the screen being shown is not enough: an echo can arrive after the screen
      // has already moved on, and then the old address looks like someone navigating backwards. Creating a
      // project did exactly that — the echo of `#/create` landed once the settings screen was up and sent it
      // back to the form, losing the state the address deliberately does not carry.
      if (ourWrites.current[0] === window.location.hash) { ourWrites.current.shift(); return; }
      ourWrites.current.length = 0;
      setScreen(screenFromHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  /** The two dashboards a session starts from — everywhere else is a working screen with its own title. */
  const isEntryScreen = screen.name === "list" || screen.name === "longList";

  function handleCreated(project: Project): void {
    setListRefreshToken((token) => token + 1);
    // Land in setup (cast/atmosphere/scene reference Asset/continuity) right away — this is the
    // continuous-flow equivalent of Python's creation wizard, rather than a separate screen the
    // user has to discover on their own afterward.
    setScreen({ name: "settings", projectId: project.id, justCreated: true });
  }

  function handleLongCreated(project: LongProject): void {
    setLongListRefreshToken((token) => token + 1);
    setScreen({ name: "longDetail", projectId: project.id });
  }

  return (
    <div
      className="flex min-h-screen bg-slate-950 text-slate-100"
      style={{
        backgroundImage:
          "radial-gradient(1100px 640px at 8% -12%, rgba(139,92,246,0.16), transparent 62%), radial-gradient(900px 700px at 100% 100%, rgba(76,29,149,0.14), transparent 65%), repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 34px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 34px)",
      }}
    >
      <Sidebar screen={screen} onNavigate={setScreen} shell={shortProjectShell} />
      <main className="relative flex-1 overflow-y-auto px-12 py-12">
        {screen.name === "list" && (
          <>
            <img
              src={heroRing}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute right-8 top-0 w-[340px] max-w-[45%]"
              style={{
                WebkitMaskImage:
                  "linear-gradient(to left, black 45%, transparent 100%), linear-gradient(to bottom, black 55%, transparent 100%)",
                WebkitMaskComposite: "source-in",
                maskImage:
                  "linear-gradient(to left, black 45%, transparent 100%), linear-gradient(to bottom, black 55%, transparent 100%)",
                maskComposite: "intersect",
              }}
            />
            <img
              src={heroLandscape}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-56 w-full object-cover opacity-90"
              style={{
                WebkitMaskImage: "linear-gradient(to top, black 40%, transparent 100%)",
                maskImage: "linear-gradient(to top, black 40%, transparent 100%)",
              }}
            />
          </>
        )}
        <div className="relative mx-auto max-w-4xl">
          {/* The studio banner is the entry screens' hero, matching §5.1's rule for the hero images. Deep
              screens carry their own <h1> title, so repeating this here would both push the actual work
              down the page and put a second <h1> on every screen. */}
          {isEntryScreen && (
            <>
              <h1 className="bg-gradient-to-r from-violet-200 via-violet-300 to-pink-300 bg-clip-text text-4xl font-semibold text-transparent">
                AI Animation Studio
              </h1>
            </>
          )}

          <div className={screen.name === "list" ? "mt-8 pt-24" : "mt-8"}>
            {screen.name === "list" && (
              <ProjectList
                refreshToken={listRefreshToken}
                onOpenProject={(projectId) => setScreen({ name: "detail", projectId })}
                onCreateNew={() => setScreen({ name: "create" })}
              />
            )}
            {screen.name === "longList" && (
              <LongProjectList
                refreshToken={longListRefreshToken}
                onOpenProject={(projectId) => setScreen({ name: "longDetail", projectId })}
                onCreateNew={() => setScreen({ name: "longCreate" })}
              />
            )}
            {screen.name === "longCreate" && (
              <CreateLongProjectForm onCreated={handleLongCreated} onCancel={() => setScreen({ name: "longList" })} />
            )}
            {screen.name === "longDetail" && (
              <LongProjectDetail
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "longList" })}
                onOpenSettings={(projectId) => setScreen({ name: "longSettings", projectId })}
                onOpenOutline={(projectId) => setScreen({ name: "longOutline", projectId })}
                onOpenEpisodeOutline={(projectId, episodeNumber) => setScreen({ name: "longEpisodeOutline", projectId, episodeNumber })}
                onOpenEpisodeScript={(projectId, episodeNumber) => setScreen({ name: "longEpisodeScript", projectId, episodeNumber })}
                onOpenMappingReview={(projectId, episodeNumber) => setScreen({ name: "longEpisodeMappingReview", projectId, episodeNumber })}
                onOpenImageGeneration={(projectId, episodeNumber) => setScreen({ name: "longEpisodeImageGeneration", projectId, episodeNumber })}
                onOpenVideoWorkflow={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber })}
                onOpenVideoMerge={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoMerge", projectId, episodeNumber })}
                onOpenContinuity={(projectId, episodeNumber) => setScreen({ name: "longEpisodeContinuity", projectId, episodeNumber })}
                onOpenNarrationReview={(projectId, episodeNumber) => setScreen({ name: "longEpisodeNarrationReview", projectId, episodeNumber })}
                onOpenGallery={(projectId) => setScreen({ name: "assets", initialQuery: projectId })}
                onArchived={() => { setLongListRefreshToken((token) => token + 1); setScreen({ name: "longList" }); }}
              />
            )}
            {screen.name === "longSettings" && (
              <LongProjectSettingsScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "longOutline" && (
              <LongProjectOutlineScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "longEpisodeOutline" && <LongEpisodeOutlineScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })} onOpenScript={(projectId, episodeNumber) => setScreen({ name: "longEpisodeScript", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeScript" && <LongEpisodeScriptScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })} onOpenMappingReview={(projectId, episodeNumber) => setScreen({ name: "longEpisodeMappingReview", projectId, episodeNumber })} />}
            {/* The same screen the short project uses. A Long Episode runs the identical review flow over the
                identical shapes, so it is told where to send its calls rather than reimplemented — the old
                LongEpisodeMappingReviewScreen was that reimplementation, and it could neither create a mapping
                nor accept a character Folder its own picker offered. */}
            {screen.name === "longEpisodeMappingReview" && (
              <MappingReviewScreen
                api={episodeMappingApi(screen.projectId, screen.episodeNumber)}
                onBack={() => setScreen({ name: "longEpisodeScript", projectId: screen.projectId, episodeNumber: screen.episodeNumber })}
                onOpenImageGeneration={() => setScreen({ name: "longEpisodeImageGeneration", projectId: screen.projectId, episodeNumber: screen.episodeNumber })}
              />
            )}
            {screen.name === "longEpisodeImageGeneration" && <LongEpisodeImageGenerationScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeMappingReview", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenVideoWorkflow={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeVideoWorkflow" && <LongEpisodeVideoWorkflowScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeImageGeneration", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenMerge={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoMerge", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeVideoMerge" && <LongEpisodeVideoMergeScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeVideoWorkflow", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenContinuity={(projectId, episodeNumber) => setScreen({ name: "longEpisodeContinuity", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeNarrationReview" && (
              <LongEpisodeNarrationReviewScreen
                projectId={screen.projectId}
                episodeNumber={screen.episodeNumber}
                onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "longEpisodeSettings" && <LongEpisodeSettingsScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeOutline", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} />}
            {screen.name === "longEpisodeContinuity" && <LongEpisodeContinuityScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeVideoMerge", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenNextEpisode={(projectId, episodeNumber) => setScreen({ name: "longEpisodeScript", projectId, episodeNumber })} />}
            {screen.name === "create" && (
              <CreateProjectForm onCreated={handleCreated} onCancel={() => setScreen({ name: "list" })} />
            )}
            {screen.name === "detail" && (
              <ProjectDetail
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "list" })}
                onOpenMappingReview={(projectId) => setScreen({ name: "mappingReview", projectId })}
                onOpenSettings={(projectId) => setScreen({ name: "settings", projectId })}
                onOpenStoryPrompt={(projectId) => setScreen({ name: "storyPrompt", projectId })}
                onOpenImageGeneration={(projectId) => setScreen({ name: "imageGeneration", projectId })}
                onOpenVideoPreview={(projectId) => setScreen({ name: "videoPreview", projectId })}
                onOpenVideoWorkflow={(projectId, jobId) => setScreen({ name: "videoWorkflow", projectId, jobId })}
                onOpenVideoMerge={(projectId) => setScreen({ name: "videoMerge", projectId })}
                onOpenGallery={(projectId) => setScreen({ name: "assets", initialQuery: projectId })}
                onOpenNarrationReview={(projectId) => setScreen({ name: "narrationReview", projectId })}
                onOpenSceneEdit={(projectId) => setScreen({ name: "sceneEdit", projectId })}
                onArchived={() => { setListRefreshToken((token) => token + 1); setScreen({ name: "list" }); }}
              />
            )}
            {screen.name === "mappingReview" && !photoCardSkippedScreen && (
              <MappingReviewScreen
                api={projectMappingApi(screen.projectId)}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onOpenImageGeneration={() => setScreen({ name: "imageGeneration", projectId: screen.projectId })}
              />
            )}
            {screen.name === "settings" && (
              <ShortProjectSettingsScreen
                projectId={screen.projectId}
                justCreated={screen.justCreated}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "storyPrompt" && !photoCardSkippedScreen && (
              <StoryPromptScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onOpenMappingReview={(projectId) => setScreen({ name: "mappingReview", projectId })}
                onOpenSettings={(projectId) => setScreen({ name: "settings", projectId })}
              />
            )}
            {screen.name === "imageGeneration" && !photoCardSkippedScreen && (
              <ImageGenerationScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "videoPreview" && !photoCardSkippedScreen && (
              <VideoPromptPreviewScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onSubmitted={(projectId, jobId) => setScreen({ name: "videoWorkflow", projectId, jobId })}
              />
            )}
            {screen.name === "videoWorkflow" && !photoCardSkippedScreen && (
              <VideoWorkflowScreen
                projectId={screen.projectId}
                jobId={screen.jobId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onOpenMerge={(projectId) => setScreen({ name: "videoMerge", projectId })}
              />
            )}
            {screen.name === "videoMerge" && (
              <VideoMergeScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {/* One notice for all seven: the screens stay as they are, and the router decides they do not
                apply to this project kind. Guarding inside each screen would put the same paragraph in seven
                files and let them drift. */}
            {photoCardSkippedScreen && "projectId" in screen && (
              <PhotoCardStepNotice
                projectId={screen.projectId}
                onOpenMerge={() => setScreen({ name: "videoMerge", projectId: (screen as { projectId: string }).projectId })}
              />
            )}
            {screen.name === "providerSettings" && (
              <ProviderSettingsScreen onBack={() => setScreen({ name: "list" })} />
            )}
            {screen.name === "assets" && <AssetLibraryScreen onBack={() => setScreen({ name: "list" })} initialQuery={screen.initialQuery} />}
            {screen.name === "videoLibrary" && <VideoLibraryScreen onBack={() => setScreen({ name: "list" })} />}
            {screen.name === "audioLibrary" && <AudioLibraryScreen onBack={() => setScreen({ name: "list" })} />}
            {/* Straight to the merge screen on success: music and its credit line live there, and a card that
                stopped at "만들어졌습니다" would leave the person to find the next step themselves. */}
            {screen.name === "photoCard" && (
              <PhotoCardScreen
                onBack={() => setScreen({ name: "list" })}
                onCreated={(projectId) => setScreen({ name: "videoMerge", projectId })}
                onOpenCard={(projectId) => setScreen({ name: "detail", projectId })}
              />
            )}
            {screen.name === "instagramPost" && <InstagramPostScreen onBack={() => setScreen({ name: "list" })} />}
            {screen.name === "sceneEdit" && !photoCardSkippedScreen && (
              <SceneEditScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "narrationReview" && !photoCardSkippedScreen && (
              <NarrationReviewScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onResume={(target) => resumeScreenFor(screen.projectId, target)}
              />
            )}
            {screen.name === "workflowGuide" && (
              <WorkflowGuideScreen onBack={() => setScreen({ name: "list" })} />
            )}
            {screen.name === "archive" && (
              <ArchiveScreen
                onBack={() => setScreen({ name: "list" })}
                onChanged={() => {
                  setListRefreshToken((token) => token + 1);
                  setLongListRefreshToken((token) => token + 1);
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
