/** Story analysis accepts up to two source blocks; count follows JavaScript string length. */
export const NOVEL_SOURCE_MAX_CHARS = 120_000;
/** Long source text is analyzed in blocks capped at 60,000 JavaScript characters. */
export const NOVEL_ANALYSIS_CHUNK_MAX_CHARS = 60_000;
/** M0 stores the pasted text directly in the project overview and keeps its original bound. */
export const NOVEL_DIRECT_SOURCE_MAX_CHARS = 6_000;
export const NOVEL_ANALYSIS_MIN_EPISODES = 1;
export const NOVEL_ANALYSIS_MAX_EPISODES = 20;
/** Fixed safe preflight estimate used with the existing monthly OpenAI ledger. */
export const NOVEL_ANALYSIS_ESTIMATED_COST_USD = 0.05;

export interface NovelStoryAnalysisInput {
  sourceText: string;
  title: string;
  logline: string;
  sourceNote?: string;
  rightsConfirmed: true;
  episodeCount: number;
  sceneCount: number;
}

export interface NovelStoryCharacter {
  id: string;
  name: string;
  role: "protagonist" | "supporting";
  appearance: string;
  personality: string;
}

export interface NovelStoryEpisode {
  episodeNumber: number;
  title: string;
  summary: string;
  mainEvent: string;
  conflict: string;
  cliffhanger: string;
  nextEpisodeHook: string;
}

export interface NovelStoryAnalysis {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  theme: string;
  characters: NovelStoryCharacter[];
  episodes: NovelStoryEpisode[];
  warnings: string[];
}

export interface NovelStoryAnalysisPreviewResponse {
  preview: {
    inputSha256: string;
    promptSha256: string;
    prompt: string;
    model: string;
    sourceCharacterCount: number;
    sourceChunkCount: number;
    providerCallCount: number;
    /** Exact prompts sent after approval, in call order. */
    prompts: string[];
    estimatedCostUsd: number;
    providerAvailable: boolean;
  };
  budget?: {
    monthlyLimitUsd: number;
    spentUsd: number;
    remainingUsd: number;
    estimatedRequestCostUsd: number;
    canSpend: boolean;
  };
}

export interface ApproveNovelStoryAnalysisRequest extends NovelStoryAnalysisInput {
  inputSha256: string;
  promptSha256: string;
  approved: true;
}

export interface NovelStorySourceMetadata {
  inputSha256: string;
  promptSha256: string;
  title: string;
  sourceNote?: string;
  rightsConfirmedAt: string;
  analyzedAt: string;
  model: string;
  episodeCount: number;
  sceneCount: number;
}

export interface ApproveNovelStoryAnalysisResponse {
  analysis: NovelStoryAnalysis;
  source: NovelStorySourceMetadata;
  reused: boolean;
  saved: boolean;
  spendUnrecorded?: boolean;
}

/** Creates a Long Project from the analysis the person reviewed and edited. The source text is never included. */
export interface CreateNovelStoryProjectRequest {
  projectId: string;
  settings: import("./api.js").LongProjectSettingsInput;
  source: NovelStorySourceMetadata;
  analysis: NovelStoryAnalysis;
  /** Optional existing character Folder selected for the protagonist. */
  protagonistAssetId?: string;
  /** Optional character Folders selected for supporting cast, keyed by the reviewed character ID. */
  supportingCharacterAssetLinks?: NovelStoryCharacterAssetLink[];
}

export interface NovelStoryCharacterAssetLink {
  characterId: string;
  assetId: string;
}

/** One reviewed character image. The source hash keeps identical names in different stories separate. */
export interface NovelCharacterImageInput {
  storyInputSha256: string;
  characterId: string;
  name: string;
  appearance: string;
  personality: string;
}

export interface NovelCharacterImagePreviewResponse {
  preview: {
    inputSha256: string;
    promptSha256: string;
    prompt: string;
    model: string;
    size: string;
    estimatedCostUsd: number;
    providerAvailable: boolean;
  };
  budget?: import("./api.js").BudgetPreview;
}

export interface GenerateNovelCharacterImageRequest extends NovelCharacterImageInput {
  inputSha256: string;
  promptSha256: string;
  approved: true;
}

export interface GenerateNovelCharacterImageResponse {
  folderAssetId: string;
  imageAssetId: string;
  reused: boolean;
  spendUnrecorded?: boolean;
}
