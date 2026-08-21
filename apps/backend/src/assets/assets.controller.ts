import * as fs from "node:fs/promises";
import { ArgumentsHost, BadRequestException, Catch, Controller, Delete, ExceptionFilter, Get, Param, Patch, PayloadTooLargeException, Post, Query, Body, UploadedFile, UseFilters, UseInterceptors, StreamableFile, Res } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { CreateAssetResponse, DeleteAssetResponse, GetAssetResponse, ListAssetsResponse, UpdateAssetResponse } from "@ai-animation-studio/shared";
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
  async content(@Param("assetId") assetId: string, @Res({ passthrough: true }) response: HttpResponse): Promise<StreamableFile> {
    const content = await this.service.content(assetId);
    const extension = content.extension;
    try {
      const handle = await fs.open(content.path, "r");
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); throw invalidAssetFile("Asset image is unavailable."); }
      response.type(extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg");
      response.setHeader("Content-Disposition", `inline; filename="asset${extension}"`);
      response.setHeader("Content-Length", String(stat.size));
      response.setHeader("X-Content-Type-Options", "nosniff");
      return new StreamableFile(handle.createReadStream());
    } catch (error) {
      if (error instanceof AssetApiException) throw error;
      throw invalidAssetFile("Asset image is unavailable.");
    }
  }
  @Get(":assetId") get(@Param("assetId") assetId: string): Promise<GetAssetResponse> { return this.service.get(assetId); }
  @Post()
  @UseFilters(AssetUploadExceptionFilter)
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 1, parts: 3, fieldSize: 1024 * 1024 } }))
  create(@UploadedFile() file: MemoryUpload | undefined, @Body() body: unknown): Promise<CreateAssetResponse> {
    return this.service.createMultipart(file, body);
  }
  @Patch(":assetId") update(@Param("assetId") assetId: string, @Body() body: unknown): Promise<UpdateAssetResponse> { return this.service.update(assetId, body); }
  @Delete(":assetId") remove(@Param("assetId") assetId: string): Promise<DeleteAssetResponse> { return this.service.remove(assetId); }
}
