import { useState } from "react";
import type { LongProject, Project } from "@ai-animation-studio/shared";

import heroRing from "./assets/hero-ring.png";
import heroLandscape from "./assets/hero-landscape.png";

import { CreateProjectForm } from "./components/CreateProjectForm.js";
import { ProjectDetail } from "./components/ProjectDetail.js";
import { ProjectList } from "./components/ProjectList.js";
import { ProviderSettingsScreen } from "./components/ProviderSettingsScreen.js";
import { AssetLibraryScreen } from "./components/AssetLibraryScreen.js";
import { MappingReviewScreen } from "./components/MappingReviewScreen.js";
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
import { LongStoryBibleScreen } from "./components/LongStoryBibleScreen.js";
import { LongEpisodeScriptScreen } from "./components/LongEpisodeScriptScreen.js";
import { LongEpisodeMappingReviewScreen } from "./components/LongEpisodeMappingReviewScreen.js";
import { LongEpisodeImageGenerationScreen } from "./components/LongEpisodeImageGenerationScreen.js";
import { LongEpisodeVideoWorkflowScreen } from "./components/LongEpisodeVideoWorkflowScreen.js";
import { LongEpisodeVideoMergeScreen } from "./components/LongEpisodeVideoMergeScreen.js";
import { LongEpisodeContinuityScreen } from "./components/LongEpisodeContinuityScreen.js";
import { ArchiveScreen } from "./components/ArchiveScreen.js";

type Screen =
  | { name: "list" }
  | { name: "create" }
  | { name: "detail"; projectId: string }
  | { name: "mappingReview"; projectId: string }
  | { name: "settings"; projectId: string; justCreated?: boolean }
  | { name: "storyPrompt"; projectId: string }
  | { name: "imageGeneration"; projectId: string }
  | { name: "videoPreview"; projectId: string }
  | { name: "videoWorkflow"; projectId: string; jobId: string }
  | { name: "videoMerge"; projectId: string }
  | { name: "providerSettings" }
  | { name: "assets"; initialQuery?: string }
  | { name: "archive" }
  | { name: "longList" }
  | { name: "longCreate" }
  | { name: "longDetail"; projectId: string }
  | { name: "longSettings"; projectId: string }
  | { name: "longOutline"; projectId: string }
  | { name: "longStoryBible"; projectId: string }
  | { name: "longEpisodeScript"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeMappingReview"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeImageGeneration"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeVideoWorkflow"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeVideoMerge"; projectId: string; episodeNumber: number }
  | { name: "longEpisodeContinuity"; projectId: string; episodeNumber: number };

const LONG_PROJECT_SCREEN_NAMES = new Set<Screen["name"]>([
  "longDetail", "longSettings", "longOutline", "longStoryBible",
  "longEpisodeScript", "longEpisodeMappingReview", "longEpisodeImageGeneration",
  "longEpisodeVideoWorkflow", "longEpisodeVideoMerge", "longEpisodeContinuity",
]);

const SHORT_PROJECT_SCREEN_NAMES = new Set<Screen["name"]>([
  "list", "create", "detail", "mappingReview", "settings", "storyPrompt",
  "imageGeneration", "videoPreview", "videoWorkflow", "videoMerge",
]);

type NavIconName = "home" | "long" | "library" | "archive" | "settings";

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
    case "library":
      return (
        <svg {...shared}>
          <path d="M4 19V5a1 1 0 0 1 1-1h4v16H5a1 1 0 0 1-1-1Z" />
          <path d="M9 4h6v16H9z" />
          <path d="M15 5.3 18.4 6a1 1 0 0 1 .8 1.2L17 20l-3.4-.6" />
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
    case "settings":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a7.9 7.9 0 0 0 0-3l1.9-1.5-2-3.4-2.3.6a7.9 7.9 0 0 0-2.6-1.5L14 2h-4l-.4 2.7a7.9 7.9 0 0 0-2.6 1.5l-2.3-.6-2 3.4L4.6 10.5a7.9 7.9 0 0 0 0 3L2.7 15l2 3.4 2.3-.6a7.9 7.9 0 0 0 2.6 1.5L10 22h4l.4-2.7a7.9 7.9 0 0 0 2.6-1.5l2.3.6 2-3.4-1.9-1.5Z" />
        </svg>
      );
  }
}

type NavSection = "short" | "long" | "assets" | "archive" | "providerSettings";

function navSectionFor(name: Screen["name"]): NavSection | null {
  if (name === "assets") return "assets";
  if (name === "archive") return "archive";
  if (name === "providerSettings") return "providerSettings";
  if (LONG_PROJECT_SCREEN_NAMES.has(name) || name === "longList" || name === "longCreate") return "long";
  if (SHORT_PROJECT_SCREEN_NAMES.has(name)) return "short";
  return null;
}

/** Always visible so a section (Asset Library, API 설정, 장기 프로젝트) is never more than one click away, no matter how deep the current screen is. */
function NavBar({ current, onNavigate }: { current: Screen["name"]; onNavigate: (screen: Screen) => void }) {
  const section = navSectionFor(current);
  const items: { key: NavSection; icon: NavIconName; label: string; target: Screen }[] = [
    { key: "short", icon: "home", label: "단기 프로젝트", target: { name: "list" } },
    { key: "long", icon: "long", label: "장기 프로젝트", target: { name: "longList" } },
    { key: "assets", icon: "library", label: "Asset Library", target: { name: "assets" } },
    { key: "archive", icon: "archive", label: "보관함", target: { name: "archive" } },
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
      {tab(screen.name, "longDetail", "프로젝트 개요", () => onNavigate({ name: "longDetail", projectId }))}
      {tab(screen.name, "longSettings", "설정", () => onNavigate({ name: "longSettings", projectId }))}
      {tab(screen.name, "longOutline", "스토리 개요", () => onNavigate({ name: "longOutline", projectId }))}
      {tab(screen.name, "longStoryBible", "Story Bible", () => onNavigate({ name: "longStoryBible", projectId }))}
      {episodeNumber !== undefined && (
        <>
          <span className="mx-1 text-sm text-slate-500">·</span>
          <span className="text-sm text-slate-400">Episode {episodeNumber}</span>
          {tab(screen.name, "longEpisodeScript", "대본", () => onNavigate({ name: "longEpisodeScript", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeMappingReview", "Asset Mapping", () => onNavigate({ name: "longEpisodeMappingReview", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeImageGeneration", "이미지", () => onNavigate({ name: "longEpisodeImageGeneration", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeVideoWorkflow", "영상", () => onNavigate({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeVideoMerge", "병합", () => onNavigate({ name: "longEpisodeVideoMerge", projectId, episodeNumber }))}
          {tab(screen.name, "longEpisodeContinuity", "Continuity", () => onNavigate({ name: "longEpisodeContinuity", projectId, episodeNumber }))}
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

const SHORT_PROJECT_PIPELINE: { name: ShortPipelineStepName; label: string }[] = [
  { name: "storyPrompt", label: "대본" },
  { name: "mappingReview", label: "장면 매핑" },
  { name: "imageGeneration", label: "이미지 생성" },
  { name: "videoPreview", label: "영상 프롬프트" },
  { name: "videoWorkflow", label: "영상 워크플로우" },
  { name: "videoMerge", label: "영상 병합" },
];

const SHORT_PIPELINE_CONTEXT_SCREENS = new Set<Screen["name"]>([
  "detail", "settings", "storyPrompt", "mappingReview", "imageGeneration",
  "videoPreview", "videoWorkflow", "videoMerge",
]);

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

/** A vertical read of where the current project sits in the fixed short-project pipeline — position only, not a claim about backend-verified completion (ProjectDetail's WorkflowProgressBar is the source of truth for that). */
function ShortProjectPipeline({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  if (!SHORT_PIPELINE_CONTEXT_SCREENS.has(screen.name) || !("projectId" in screen)) return null;
  const projectId = screen.projectId;
  const currentIndex = SHORT_PROJECT_PIPELINE.findIndex((step) => step.name === screen.name);
  return (
    <nav aria-label="단기 프로젝트 진행 단계" className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-6">
      {SHORT_PROJECT_PIPELINE.map((step, index) => {
        const isCurrent = step.name === screen.name;
        const isPast = currentIndex >= 0 && index < currentIndex;
        return (
          <button
            key={step.name}
            type="button"
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => onNavigate(shortPipelineTarget(step.name, projectId, screen))}
            className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm"
          >
            <span
              aria-hidden="true"
              className={
                isCurrent
                  ? "h-2.5 w-2.5 flex-shrink-0 rounded-full bg-violet-400 shadow-[0_0_0_4px_rgba(167,139,250,0.25)]"
                  : isPast
                    ? "h-2.5 w-2.5 flex-shrink-0 rounded-full bg-slate-400"
                    : "h-2.5 w-2.5 flex-shrink-0 rounded-full border border-slate-600"
              }
            />
            <span className={isCurrent ? "font-medium text-white" : isPast ? "text-slate-300" : "text-slate-500"}>
              {step.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Sidebar({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-slate-900 px-5 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-400">
        Prism Forge
      </p>
      <NavBar current={screen.name} onNavigate={onNavigate} />
      <LongWorkspaceNav screen={screen} onNavigate={onNavigate} />
      <ShortProjectPipeline screen={screen} onNavigate={onNavigate} />
    </aside>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [longListRefreshToken, setLongListRefreshToken] = useState(0);
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
      <Sidebar screen={screen} onNavigate={setScreen} />
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
              <p className="mt-4 max-w-2xl text-slate-400">
                TypeScript 기반 새 버전의 실행 환경이 준비되었습니다. 기존 Python
                워크플로는 새 기능이 검증될 때까지 그대로 보존됩니다.
              </p>
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
                onOpenStoryBible={(projectId) => setScreen({ name: "longStoryBible", projectId })}
                onOpenEpisodeScript={(projectId, episodeNumber) => setScreen({ name: "longEpisodeScript", projectId, episodeNumber })}
                onOpenMappingReview={(projectId, episodeNumber) => setScreen({ name: "longEpisodeMappingReview", projectId, episodeNumber })}
                onOpenImageGeneration={(projectId, episodeNumber) => setScreen({ name: "longEpisodeImageGeneration", projectId, episodeNumber })}
                onOpenVideoWorkflow={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber })}
                onOpenVideoMerge={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoMerge", projectId, episodeNumber })}
                onOpenContinuity={(projectId, episodeNumber) => setScreen({ name: "longEpisodeContinuity", projectId, episodeNumber })}
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
            {screen.name === "longStoryBible" && (
              <LongStoryBibleScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "longEpisodeScript" && <LongEpisodeScriptScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longDetail", projectId: screen.projectId })} onOpenMappingReview={(projectId, episodeNumber) => setScreen({ name: "longEpisodeMappingReview", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeMappingReview" && <LongEpisodeMappingReviewScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeScript", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenImageGeneration={(projectId, episodeNumber) => setScreen({ name: "longEpisodeImageGeneration", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeImageGeneration" && <LongEpisodeImageGenerationScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeMappingReview", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenVideoWorkflow={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoWorkflow", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeVideoWorkflow" && <LongEpisodeVideoWorkflowScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeImageGeneration", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenMerge={(projectId, episodeNumber) => setScreen({ name: "longEpisodeVideoMerge", projectId, episodeNumber })} />}
            {screen.name === "longEpisodeVideoMerge" && <LongEpisodeVideoMergeScreen projectId={screen.projectId} episodeNumber={screen.episodeNumber} onBack={() => setScreen({ name: "longEpisodeVideoWorkflow", projectId: screen.projectId, episodeNumber: screen.episodeNumber })} onOpenContinuity={(projectId, episodeNumber) => setScreen({ name: "longEpisodeContinuity", projectId, episodeNumber })} />}
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
                onArchived={() => { setListRefreshToken((token) => token + 1); setScreen({ name: "list" }); }}
              />
            )}
            {screen.name === "mappingReview" && (
              <MappingReviewScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "settings" && (
              <ShortProjectSettingsScreen
                projectId={screen.projectId}
                justCreated={screen.justCreated}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "storyPrompt" && (
              <StoryPromptScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "imageGeneration" && (
              <ImageGenerationScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
              />
            )}
            {screen.name === "videoPreview" && (
              <VideoPromptPreviewScreen
                projectId={screen.projectId}
                onBack={() => setScreen({ name: "detail", projectId: screen.projectId })}
                onSubmitted={(projectId, jobId) => setScreen({ name: "videoWorkflow", projectId, jobId })}
              />
            )}
            {screen.name === "videoWorkflow" && (
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
            {screen.name === "providerSettings" && (
              <ProviderSettingsScreen onBack={() => setScreen({ name: "list" })} />
            )}
            {screen.name === "assets" && <AssetLibraryScreen onBack={() => setScreen({ name: "list" })} initialQuery={screen.initialQuery} />}
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
