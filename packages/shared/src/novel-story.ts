/** Story Studio M1 input bound. Count follows JavaScript string length, matching the existing text area. */
export const NOVEL_SOURCE_MAX_CHARS = 6_000;
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
