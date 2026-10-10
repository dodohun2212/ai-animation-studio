import {
  API_ROUTES,
  BUDGET_LIMIT_ROUTE_HINT,
  type ApproveNovelStoryAnalysisRequest,
  type ApproveNovelStoryAnalysisResponse,
  type GenerateNovelCharacterImageRequest,
  type GenerateNovelCharacterImageResponse,
  type NovelCharacterImageInput,
  type NovelCharacterImagePreviewResponse,
  type NovelStoryAnalysisInput,
  type NovelStoryAnalysisPreviewResponse,
} from "@ai-animation-studio/shared";

import { INTERNAL_ERROR, SERVER_UNAVAILABLE_ERROR, isServerUnavailable } from "./httpError.js";

/**
 * 소설 분석(M1) — **미리보기(무료)** 와 **승인 뒤 실행(유료 1회)** 을 갈라 둔 두 길.
 *
 * 🔴 미리보기는 OpenAI 를 부르지 않고 저장도 하지 않습니다. 실행(`POST /story-analysis`)만 돈이 나가고, 그건 사람이 미리보기를 본 뒤
 * 따로 승인했을 때뿐이며 이 파일의 `approveStoryAnalysis` 가 그 한 길입니다. 이 모듈은 둘 다 **로컬 백엔드**만 부릅니다.
 * 🟠 오류 문장은 코드마다 따로입니다 — 「요청이 나갔나·돈이 나갔나」가 코드마다 다르고, 그게 다음에 할 일을 정합니다.
 */
export class StoryAnalysisApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "StoryAnalysisApiError";
    this.code = code;
    this.details = details;
  }
}

const SAFE_ERRORS: Record<string, string> = {
  STORY_ANALYSIS_INVALID_REQUEST: "입력이 조건에 맞지 않습니다. 본문(120,000자 이하)·제목(120자)·한 줄 소개(500자)·출처 메모(500자)·회차(1–20)·회차당 장면(2–12)과 권리 확인을 확인해 주세요. 요청은 나가지 않았습니다.",
  STORY_ANALYSIS_PROMPT_STALE: "미리보기를 만든 뒤 입력이 바뀌어 승인할 수 없습니다. 요청은 나가지 않았습니다 — 미리보기를 다시 만들어 확인한 뒤 승인해 주세요.",
  STORY_ANALYSIS_KEY_MISSING: "OpenAI 키가 저장·연결되어 있지 않습니다. 요청은 나가지 않았습니다 — API 설정에 키를 넣은 뒤 다시 승인해 주세요.",
  STORY_ANALYSIS_BUDGET_EXCEEDED: `이번 달 OpenAI 예산이 부족해 요청을 보내지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  STORY_ANALYSIS_ALREADY_ATTEMPTED: "같은 입력으로 이미 분석을 시작했거나 끝냈습니다. 비용이 중복되지 않도록 다시 보내지 않았습니다. 글이나 설정을 바꾸면 새 입력으로 다시 미리보기·승인할 수 있고, 청구 여부는 OpenAI 사용량에서 확인해 주세요.",
  BUDGET_LEDGER_UNREADABLE: "OpenAI 사용 기록 파일을 읽지 못해 유료 요청을 보내지 않았습니다. 기록을 확인하기 전에는 보내지 않습니다.",
};
const NETWORK = { code: "CLIENT_NETWORK_ERROR", message: "로컬 서버에 연결하지 못했습니다. 요청이 나갔는지 알 수 없으니, 다시 승인하기 전에 서버가 켜져 있는지 확인해 주세요." };
const MALFORMED = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 확인할 수 없습니다." };
const UNKNOWN = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

const SPEND_UNRECORDED_NOTE = " 지출 기록이 남지 않았을 수 있어 월 예산 장부와 실제가 다를 수 있습니다 — OpenAI 사용량을 확인해 주세요.";

/** 서버의 원문 대신 코드마다 정해 둔 문장만 보여 줍니다. 저장·Provider 오류는 서버가 알려 준 세부(요청이 나갔나·지출 기록)로 갈립니다. */
export function toStoryAnalysisDisplayError(error: unknown): { code: string; message: string } {
  if (!(error instanceof StoryAnalysisApiError)) return UNKNOWN;
  const spendUnrecorded = error.details?.spendUnrecorded === true;
  if (error.code === "STORY_ANALYSIS_STORAGE_ERROR") {
    const requestSent = error.details?.requestSent === true;
    return {
      code: error.code,
      message: (requestSent
        ? "분석 요청은 나갔지만 결과를 저장하지 못했습니다. 비용이 청구되었을 수 있고, 같은 입력은 다시 보내지 않습니다. 저장 폴더(story_sources)를 확인해 주세요."
        : "분석 기록 파일을 읽거나 쓰지 못해 요청을 보내지 않았습니다. 저장 폴더(story_sources)를 확인한 뒤 다시 시도해 주세요.") + (spendUnrecorded ? SPEND_UNRECORDED_NOTE : ""),
    };
  }
  if (error.code === "STORY_ANALYSIS_PROVIDER_ERROR") {
    return {
      code: error.code,
      message: "OpenAI에서 분석 결과를 받지 못했습니다. 요청이 나갔을 수 있어 같은 입력은 자동으로 다시 보내지 않습니다 — 글이나 설정을 조금 바꿔 새로 미리보기·승인하거나, 청구 여부를 OpenAI 사용량에서 확인해 주세요." + (spendUnrecorded ? SPEND_UNRECORDED_NOTE : ""),
    };
  }
  if (Object.prototype.hasOwnProperty.call(SAFE_ERRORS, error.code)) return { code: error.code, message: SAFE_ERRORS[error.code]! };
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

export function isNovelStoryAnalysisPreviewResponse(value: unknown): value is NovelStoryAnalysisPreviewResponse {
  if (!isRecord(value) || !isRecord(value.preview)) return false;
  const preview = value.preview;
  if (!isString(preview.inputSha256) || !isString(preview.promptSha256) || !isString(preview.prompt) || !isString(preview.model)) return false;
  if (!isFiniteNumber(preview.sourceCharacterCount) || !isFiniteNumber(preview.estimatedCostUsd) || typeof preview.providerAvailable !== "boolean") return false;
  // M4 긴 글: 조각 수·호출 수·호출 순서대로의 프롬프트. 호출 수와 프롬프트 수가 어긋나면 무엇을 승인하는지 말할 수 없어 거절합니다.
  if (!isFiniteNumber(preview.sourceChunkCount) || preview.sourceChunkCount < 1 || !isFiniteNumber(preview.providerCallCount) || preview.providerCallCount < 1) return false;
  if (!isStringArray(preview.prompts) || preview.prompts.length !== preview.providerCallCount) return false;
  if (value.budget === undefined) return true;
  const budget = value.budget;
  return isRecord(budget)
    && isFiniteNumber(budget.monthlyLimitUsd) && isFiniteNumber(budget.spentUsd) && isFiniteNumber(budget.remainingUsd)
    && isFiniteNumber(budget.estimatedRequestCostUsd) && typeof budget.canSpend === "boolean";
}

export function isApproveNovelStoryAnalysisResponse(value: unknown): value is ApproveNovelStoryAnalysisResponse {
  if (!isRecord(value) || typeof value.reused !== "boolean" || typeof value.saved !== "boolean") return false;
  if (value.spendUnrecorded !== undefined && typeof value.spendUnrecorded !== "boolean") return false;
  const analysis = value.analysis;
  if (!isRecord(analysis)) return false;
  if (![analysis.title, analysis.logline, analysis.genre, analysis.tone, analysis.theme].every(isString)) return false;
  if (!isStringArray(analysis.warnings)) return false;
  if (!Array.isArray(analysis.characters) || !analysis.characters.every((character) =>
    isRecord(character) && isString(character.id) && isString(character.name)
    && (character.role === "protagonist" || character.role === "supporting")
    && isString(character.appearance) && isString(character.personality))) return false;
  if (!Array.isArray(analysis.episodes) || !analysis.episodes.every((episode) =>
    isRecord(episode) && isFiniteNumber(episode.episodeNumber)
    && [episode.title, episode.summary, episode.mainEvent, episode.conflict, episode.cliffhanger, episode.nextEpisodeHook].every(isString))) return false;
  const source = value.source;
  return isRecord(source)
    && [source.inputSha256, source.promptSha256, source.title, source.rightsConfirmedAt, source.analyzedAt, source.model].every(isString)
    && (source.sourceNote === undefined || isString(source.sourceNote))
    && isFiniteNumber(source.episodeCount) && isFiniteNumber(source.sceneCount);
}

async function requestJson<T>(url: string, init: RequestInit, guard: (value: unknown) => value is T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new StoryAnalysisApiError(NETWORK.code, NETWORK.message);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const carriedCode = isRecord(body) && typeof body.code === "string" && body.code.trim() ? body.code : MALFORMED.code;
    if (isServerUnavailable(response.status, carriedCode)) {
      throw new StoryAnalysisApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new StoryAnalysisApiError(carriedCode, "", isRecord(body) && isRecord(body.details) ? body.details : undefined);
  }
  if (!guard(body)) throw new StoryAnalysisApiError(MALFORMED.code, MALFORMED.message);
  return body;
}

const jsonPost = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** 미리보기 — **OpenAI 를 부르지 않고 아무것도 저장하지 않습니다.** 정확한 프롬프트·해시·모델·견적을 돌려줍니다. */
export function previewStoryAnalysis(input: NovelStoryAnalysisInput): Promise<NovelStoryAnalysisPreviewResponse> {
  return requestJson(API_ROUTES.novelStoryAnalysisPreview, jsonPost(input), isNovelStoryAnalysisPreviewResponse);
}

/** 승인 뒤 실행 — **OpenAI 에 한 번 보내고 돈이 나갑니다.** 미리보기 해시와 `approved: true` 없이는 서버가 거절합니다. 자동 재시도는 없습니다. */
export function approveStoryAnalysis(request: ApproveNovelStoryAnalysisRequest): Promise<ApproveNovelStoryAnalysisResponse> {
  return requestJson(API_ROUTES.novelStoryAnalysis, jsonPost(request), isApproveNovelStoryAnalysisResponse);
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 인물 이미지(M3) — 분석한 인물 한 명을 **이미지로 만들어 보관함의 캐릭터 폴더로** 등록합니다.
 * 같은 규칙입니다: 미리보기(무료·저장 없음) → 사람의 별도 승인 → 유료 1회. 자동 재시도 없음.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

const CHARACTER_IMAGE_ERRORS: Record<string, string> = {
  NOVEL_CHARACTER_IMAGE_INVALID_REQUEST: "인물 이름·외모·성격을 확인해 주세요(이름 80자, 외모·성격은 각각 500자까지). 요청은 나가지 않았습니다.",
  NOVEL_CHARACTER_IMAGE_PROMPT_STALE: "미리보기를 만든 뒤 인물 설명이 바뀌어 승인할 수 없습니다. 요청은 나가지 않았습니다 — 미리보기를 다시 만들어 확인해 주세요.",
  NOVEL_CHARACTER_IMAGE_KEY_MISSING: "OpenAI 키가 저장·연결되어 있지 않습니다. 요청은 나가지 않았습니다 — API 설정에 키를 넣은 뒤 다시 승인해 주세요.",
  NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED: `이번 달 OpenAI 예산이 부족해 이미지를 만들지 않았습니다. ${BUDGET_LIMIT_ROUTE_HINT}`,
  NOVEL_CHARACTER_IMAGE_ALREADY_ATTEMPTED: "이 인물 이미지 요청은 이미 전송됐을 수 있어 중복 청구를 막으려고 다시 보내지 않았습니다. 다시 눌러도 보내지 않습니다. 인물 설명을 바꾸면 새 요청으로 미리보기·승인할 수 있고, 청구 여부는 OpenAI 사용량에서 확인해 주세요.",
  BUDGET_LEDGER_UNREADABLE: "OpenAI 사용 기록 파일을 읽지 못해 유료 요청을 보내지 않았습니다. 기록을 확인하기 전에는 보내지 않습니다.",
};

export interface CharacterImageDisplayError {
  code: string;
  message: string;
  /** 이미 치른 그림을 디스크에 못 쓴 드문 경우 — 사람이 내려받을 수 있게 PNG 를 그대로 돌려줍니다. */
  recoveryImageBase64?: string;
}

/** 서버의 원문 대신 코드마다 정해 둔 문장만 보여 줍니다. 저장·Provider 오류는 서버가 알려 준 세부로 갈립니다. */
export function toCharacterImageDisplayError(error: unknown): CharacterImageDisplayError {
  if (!(error instanceof StoryAnalysisApiError)) return UNKNOWN;
  const spendUnrecorded = error.details?.spendUnrecorded === true;
  if (error.code === "NOVEL_CHARACTER_IMAGE_STORAGE_ERROR") {
    const recovery = typeof error.details?.recoveryImageBase64 === "string" && error.details.recoveryImageBase64.length > 0 ? error.details.recoveryImageBase64 : undefined;
    const requestSent = error.details?.requestSent === true;
    const body = recovery
      ? "이미 청구된 그림을 디스크에 저장하지 못했습니다. 다시 보내지 않으니, 아래에서 그림을 내려받아 보관해 주세요."
      : requestSent
        ? "그림은 만들어졌지만(비용 청구) 보관함에 등록하지 못했습니다. 다시 승인해도 새로 청구하지 않고 저장된 그림으로 등록만 다시 시도합니다."
        : "보관함 기록 파일을 읽거나 쓰지 못해 요청을 보내지 않았습니다. 저장 폴더를 확인한 뒤 다시 시도해 주세요.";
    return { code: error.code, message: body + (spendUnrecorded ? SPEND_UNRECORDED_NOTE : ""), ...(recovery ? { recoveryImageBase64: recovery } : {}) };
  }
  if (error.code === "NOVEL_CHARACTER_IMAGE_PROVIDER_ERROR") {
    const reason = typeof error.details?.providerMessage === "string" && error.details.providerMessage.trim() ? ` OpenAI의 말: 「${error.details.providerMessage.trim()}」` : "";
    const requestId = typeof error.details?.providerRequestId === "string" && error.details.providerRequestId.trim() ? ` (요청 ID ${error.details.providerRequestId.trim()})` : "";
    return {
      code: error.code,
      message: `OpenAI에서 그림을 받지 못했습니다.${reason}${requestId} 요청이 나갔을 수 있어 같은 설명은 자동으로 다시 보내지 않습니다 — 설명을 조금 바꿔 새로 미리보기·승인하거나, 청구 여부를 OpenAI 사용량에서 확인해 주세요.` + (spendUnrecorded ? SPEND_UNRECORDED_NOTE : ""),
    };
  }
  if (Object.prototype.hasOwnProperty.call(CHARACTER_IMAGE_ERRORS, error.code)) return { code: error.code, message: CHARACTER_IMAGE_ERRORS[error.code]! };
  if (error.code === NETWORK.code) return NETWORK;
  if (error.code === MALFORMED.code) return MALFORMED;
  if (error.code === SERVER_UNAVAILABLE_ERROR.code) return SERVER_UNAVAILABLE_ERROR;
  if (error.code === INTERNAL_ERROR.code) return INTERNAL_ERROR;
  return UNKNOWN;
}

export function isNovelCharacterImagePreviewResponse(value: unknown): value is NovelCharacterImagePreviewResponse {
  if (!isRecord(value) || !isRecord(value.preview)) return false;
  const preview = value.preview;
  if (![preview.inputSha256, preview.promptSha256, preview.prompt, preview.model, preview.size].every(isString)) return false;
  if (!isFiniteNumber(preview.estimatedCostUsd) || typeof preview.providerAvailable !== "boolean") return false;
  if (value.budget === undefined) return true;
  const budget = value.budget;
  return isRecord(budget) && isFiniteNumber(budget.monthlyLimitUsd) && isFiniteNumber(budget.spentUsd) && isFiniteNumber(budget.remainingUsd)
    && isFiniteNumber(budget.estimatedRequestCostUsd) && typeof budget.canSpend === "boolean";
}

export function isGenerateNovelCharacterImageResponse(value: unknown): value is GenerateNovelCharacterImageResponse {
  return isRecord(value) && isString(value.folderAssetId) && value.folderAssetId.length > 0 && isString(value.imageAssetId) && value.imageAssetId.length > 0
    && typeof value.reused === "boolean" && (value.spendUnrecorded === undefined || typeof value.spendUnrecorded === "boolean");
}

/** 미리보기 — **OpenAI 를 부르지 않고 저장하지 않습니다.** 실제로 보낼 그림 프롬프트·해시·모델·크기·견적·예산을 돌려줍니다. */
export function previewNovelCharacterImage(input: NovelCharacterImageInput): Promise<NovelCharacterImagePreviewResponse> {
  return requestJson(API_ROUTES.novelCharacterImagePreview, jsonPost(input), isNovelCharacterImagePreviewResponse);
}

/** 승인 뒤 실행 — **그림 한 장을 OpenAI 에 한 번 요청하고 돈이 나갑니다.** 해시와 `approved: true` 없이는 서버가 거절합니다. 자동 재시도 없음. */
export function generateNovelCharacterImage(request: GenerateNovelCharacterImageRequest): Promise<GenerateNovelCharacterImageResponse> {
  return requestJson(API_ROUTES.novelCharacterImageGenerate, jsonPost(request), isGenerateNovelCharacterImageResponse);
}
