import * as fs from "node:fs/promises";
import { ArgumentsHost, BadRequestException, Catch, Controller, Delete, ExceptionFilter, Get, HttpException, Param, PayloadTooLargeException, Post, Body, UploadedFile, UseFilters, UseInterceptors, StreamableFile, Res } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { API_ROUTES, AUDIO_UPLOAD_FILE_FIELD, type DeleteAudioTrackResponse, type GetAudioLibraryResponse, type UploadAudioTrackResponse } from "@ai-animation-studio/shared";

import { AudioLibraryService } from "./audio-library.service.js";
import { AudioApiException, audioContentUnavailable, audioStorageError, invalidAudioFile } from "./audio-api.error.js";

interface MemoryUpload { buffer: Buffer; originalname: string; mimetype: string }
interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void; status(value: number): HttpResponse; json(value: unknown): void }

/** Same shape as assets.controller.ts's AssetUploadExceptionFilter — Multer/NestJS throw their own exception types (payload-too-large, malformed multipart) before this controller's method body ever runs, so they need mapping into this app's ApiError envelope too, not just AudioApiException. */
@Catch()
class AudioUploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (exception instanceof AudioApiException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof PayloadTooLargeException || exception instanceof BadRequestException) {
      const mapped = invalidAudioFile("Multipart audio upload is invalid or exceeds 50 MB.");
      response.status(mapped.getStatus()).json(mapped.getResponse());
      return;
    }
    const mapped = audioStorageError();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

@Controller()
export class AudioLibraryController {
  constructor(private readonly audio: AudioLibraryService) {}

  @Get(API_ROUTES.audioLibrary)
  list(): Promise<GetAudioLibraryResponse> {
    return this.audio.list();
  }

  @Post(API_ROUTES.audioLibraryUpload)
  @UseFilters(AudioUploadExceptionFilter)
  @UseInterceptors(FileInterceptor(AUDIO_UPLOAD_FILE_FIELD, { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 6, parts: 8, fieldSize: 1024 * 1024 } }))
  upload(@UploadedFile() file: MemoryUpload | undefined, @Body() body: unknown): Promise<UploadAudioTrackResponse> {
    return this.audio.upload(file, body);
  }

  @Delete(`${API_ROUTES.audioLibrary}/:trackId`)
  remove(@Param("trackId") trackId: string): Promise<DeleteAudioTrackResponse> {
    return this.audio.remove(trackId);
  }

  @Get(`${API_ROUTES.audioLibrary}/:trackId/content`)
  async content(@Param("trackId") trackId: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.audio.content(trackId);
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw audioContentUnavailable(); }
      response.type("audio/mpeg");
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw audioContentUnavailable();
    }
  }
}
