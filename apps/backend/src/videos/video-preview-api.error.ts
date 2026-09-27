import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@ai-animation-studio/shared";

type VideoPreviewErrorCode =
  | "INVALID_REQUEST"
  | "VIDEO_PREVIEW_NOT_ALLOWED"
  | "VIDEO_PREVIEW_IMAGES_INVALID"
  | "VIDEO_PREVIEW_DATA_INVALID"
  | "VIDEO_DIALOGUE_MODEL_UNSUPPORTED";

class VideoPreviewApiException extends HttpException {
  constructor(code: VideoPreviewErrorCode, message: string, status: HttpStatus) {
    const body: ApiError = { code, message };
    super(body, status);
  }
}

export const invalidVideoPreviewRequest = () =>
  new VideoPreviewApiException("INVALID_REQUEST", "Video preview does not accept request fields.", HttpStatus.BAD_REQUEST);
export const videoPreviewNotAllowed = () =>
  new VideoPreviewApiException("VIDEO_PREVIEW_NOT_ALLOWED", "Video preview requires six approved images.", HttpStatus.CONFLICT);
export const videoPreviewImagesInvalid = () =>
  new VideoPreviewApiException("VIDEO_PREVIEW_IMAGES_INVALID", "Six valid approved PNG images are required for video preview.", HttpStatus.CONFLICT);
export const videoPreviewDataInvalid = () =>
  new VideoPreviewApiException("VIDEO_PREVIEW_DATA_INVALID", "Project story data is invalid for video preview.", HttpStatus.INTERNAL_SERVER_ERROR);
export const videoDialogueModelUnsupported = () =>
  new VideoPreviewApiException("VIDEO_DIALOGUE_MODEL_UNSUPPORTED", "선택한 영상 모델은 캐릭터 대사 음성을 생성할 수 없습니다. 영상 모델을 바꾸거나 프로젝트의 캐릭터 대사를 끄세요.", HttpStatus.CONFLICT);
