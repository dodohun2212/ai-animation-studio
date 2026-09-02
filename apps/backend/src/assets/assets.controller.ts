import * as fs from "node:fs/promises";
import { ArgumentsHost, BadRequestException, Catch, Controller, Delete, ExceptionFilter, Get, Param, Patch, PayloadTooLargeException, Post, Query, Body, UploadedFile, UseFilters, UseInterceptors, StreamableFile, Req, Res } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ASSET_UPLOAD_FILE_FIELD } from "@ai-animation-studio/shared";
import { streamStoredFile, type RangeRequest, type RangeResponse } from "../http/range-stream.js";
import type { AddAssetVersionResponse, CharacterFolderReferenceSetResponse, CreateAssetFolderResponse, CreateAssetResponse, DeleteAssetFolderResponse, DeleteAssetOwnedFileResponse, DeleteAssetResponse, GetAssetResponse, ListAssetFileAuditResponse, ListAssetsResponse, RelinkAssetResponse, SetAssetParentFolderResponse, UpdateAssetResponse } from "@ai-animation-studio/shared";
import { AssetsService } from "./assets.service.js";
import { AssetApiException, assetStorageError, invalidAssetFile } from "./asset-api.error.js";

interface MemoryUpload { buffer: Buffer; originalname: string; mimetype: string }
interface HttpResponse { type(value: string): void; setHeader(name: string, value: string): void; status(value: number): HttpResponse; json(value: unknown): void }

@Catch()
class AssetUploadExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (exception instanceof AssetApiException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof PayloadTooLargeException || exception instanceof BadRequestException) {
      const mapped = invalidAssetFile("Multipart image upload is invalid or exceeds 25 MB.");
      response.status(mapped.getStatus()).json(mapped.getResponse());
      return;
    }
    const mapped = assetStorageError();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

@Controller("assets")
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get()
  list(@Query("query") query?: string, @Query("assetType") assetType?: string): Promise<ListAssetsResponse> {
    return this.service.list(query, assetType);
  }
  @Get(":assetId/content")
  async content(@Param("assetId") assetId: string, @Req() request: RangeRequest, @Res({ passthrough: true }) response: RangeResponse): Promise<StreamableFile> {
    const content = await this.service.content(assetId);
    const extension = content.extension;
    return streamStoredFile({
      path: content.path,
      contentType: extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg",
      filename: `asset${extension}`,
      request, response,
      unavailable: () => invalidAssetFile("Asset image is unavailable."),
    });
  }
  @Get("audit") audit(): Promise<ListAssetFileAuditResponse> { return this.service.audit(); }
  @Get(":assetId") get(@Param("assetId") assetId: string): Promise<GetAssetResponse> { return this.service.get(assetId); }
  @Post()
  @UseFilters(AssetUploadExceptionFilter)
  @UseInterceptors(FileInterceptor(ASSET_UPLOAD_FILE_FIELD, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, parts: 3, fieldSize: 1024 * 1024 } }))
  create(@UploadedFile() file: MemoryUpload | undefined, @Body() body: unknown): Promise<CreateAssetResponse> {
    return this.service.createMultipart(file, body);
  }
  @Post(":assetId/versions")
  @UseFilters(AssetUploadExceptionFilter)
  @UseInterceptors(FileInterceptor(ASSET_UPLOAD_FILE_FIELD, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, parts: 3, fieldSize: 1024 * 1024 } }))
  addVersion(@Param("assetId") assetId: string, @UploadedFile() file: MemoryUpload | undefined, @Body() body: { notes?: string }): Promise<AddAssetVersionResponse> {
    return this.service.addVersion(assetId, file, body?.notes);
  }
  @Post(":assetId/relink")
  @UseFilters(AssetUploadExceptionFilter)
  @UseInterceptors(FileInterceptor(ASSET_UPLOAD_FILE_FIELD, { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 0, parts: 2, fieldSize: 1024 * 1024 } }))
  relink(@Param("assetId") assetId: string, @UploadedFile() file: MemoryUpload | undefined): Promise<RelinkAssetResponse> {
    return this.service.relink(assetId, file);
  }
  @Patch(":assetId/character-reference-set")
  updateCharacterFolderReferenceSet(@Param("assetId") assetId: string, @Body() body: unknown): Promise<CharacterFolderReferenceSetResponse> {
    return this.service.updateCharacterFolderReferenceSet(assetId, body);
  }
  @Post("folders")
  createFolder(@Body() body: unknown): Promise<CreateAssetFolderResponse> {
    return this.service.createFolder(body);
  }
  @Patch(":assetId/parent-folder")
  setParentFolder(@Param("assetId") assetId: string, @Body() body: unknown): Promise<SetAssetParentFolderResponse> {
    return this.service.setParentFolder(assetId, body);
  }
  @Patch(":assetId") update(@Param("assetId") assetId: string, @Body() body: unknown): Promise<UpdateAssetResponse> { return this.service.update(assetId, body); }
  @Delete(":assetId/owned-file") removeOwnedFile(@Param("assetId") assetId: string): Promise<DeleteAssetOwnedFileResponse> { return this.service.removeOwnedFile(assetId); }
  @Delete(":assetId/folder")
  removeFolder(
    @Param("assetId") assetId: string,
    @Query("removeChildIndexes") removeChildIndexes?: string,
    @Query("deleteManualFiles") deleteManualFiles?: string,
  ): Promise<DeleteAssetFolderResponse> {
    return this.service.removeFolder(assetId, removeChildIndexes, deleteManualFiles);
  }
  @Delete(":assetId") remove(@Param("assetId") assetId: string): Promise<DeleteAssetResponse> { return this.service.remove(assetId); }
}
