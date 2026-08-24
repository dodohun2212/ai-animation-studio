import { useState } from "react";
import type { LongProject, Project } from "@ai-animation-studio/shared";

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

/** Always visible so a section (Asset Library, API 설정, 장기 프로젝트) is never more than one click away, no matter how deep the current screen is. */
function NavBar({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <nav aria-label="주 메뉴" className="mt-6 flex flex-wrap justify-end gap-4 border-b border-white/10 pb-6">
      <button type="button" className="text-sm text-violet-300 underline" onClick={() => onNavigate({ name: "list" })}>단기 프로젝트</button>
      <button type="button" className="text-sm text-violet-300 underline" onClick={() => onNavigate({ name: "longList" })}>장기 프로젝트</button>
      <button type="button" className="text-sm text-violet-300 underline" onClick={() => onNavigate({ name: "assets" })}>Asset Library</button>
      <button type="button" className="text-sm text-violet-300 underline" onClick={() => onNavigate({ name: "providerSettings" })}>API 설정</button>
    </nav>
  );
}

const LONG_PROJECT_SCREEN_NAMES = new Set<Screen["name"]>([
  "longDetail", "longSettings", "longOutline", "longStoryBible",
  "longEpisodeScript", "longEpisodeMappingReview", "longEpisodeImageGeneration",
  "longEpisodeVideoWorkflow", "longEpisodeVideoMerge", "longEpisodeContinuity",
]);

function tab(current: Screen["name"], name: Screen["name"], label: string, onClick: () => void) {
  const active = current === name;
  return (
    <button
      key={name}
      type="button"
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 text-sm ${active ? "bg-violet-500 text-white" : "text-violet-300 underline"}`}
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
    <nav aria-label="장편 프로젝트 작업공간" className="mt-4 flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
      {tab(screen.name, "longDetail", "프로젝트 개요", () => onNavigate({ name: "longDetail", projectId }))}
      {tab(screen.name, "longSettings", "설정", () => onNavigate({ name: "longSettings", projectId }))}
      {tab(screen.name, "longOutline", "Outline", () => onNavigate({ name: "longOutline", projectId }))}
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

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "list" });
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [longListRefreshToken, setLongListRefreshToken] = useState(0);

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
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-violet-400">
          Prism Forge
        </p>
        <h1 className="mt-3 text-4xl font-semibold">AI Animation Studio</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          TypeScript 기반 새 버전의 실행 환경이 준비되었습니다. 기존 Python
          워크플로는 새 기능이 검증될 때까지 그대로 보존됩니다.
        </p>

        <NavBar onNavigate={setScreen} />
        <LongWorkspaceNav screen={screen} onNavigate={setScreen} />

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
      </section>
    </main>
  );
}
