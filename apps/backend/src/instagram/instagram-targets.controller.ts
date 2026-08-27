import { Body, Controller, Delete, Get, Header, Param, Post, Put, Query } from "@nestjs/common";
import {
  API_ROUTES,
  type GetInstagramTargetsResponse, type InstagramConnectionStatus,
  type PublishToInstagramResponse,
  type SetInstagramAppResponse, type SetInstagramTargetResponse, type StartInstagramLoginResponse,
} from "@ai-animation-studio/shared";

import { InstagramLoginService } from "./instagram-login.service.js";
import { InstagramPublishService } from "./instagram-publish.service.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

/** Deliberately plain: no scripts, no styling that could load anything, nothing but the two sentences. */
function loginResultPage(title: string, detail: string): string {
  const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escape(title)}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;padding:3rem;line-height:1.7">`
    + `<h1 style="font-size:1.25rem">${escape(title)}</h1><p>${escape(detail)}</p></body></html>`;
}

@Controller()
export class InstagramTargetsController {
  constructor(
    private readonly targets: InstagramTargetsService,
    private readonly login: InstagramLoginService,
    private readonly publishing: InstagramPublishService,
  ) {}

  @Get(API_ROUTES.instagramTargets)
  list(): Promise<GetInstagramTargetsResponse> {
    return this.targets.list();
  }

  @Put(API_ROUTES.instagramTarget)
  select(@Body() body: unknown): Promise<SetInstagramTargetResponse> {
    return this.targets.select(body);
  }

  @Get(API_ROUTES.instagramConnection)
  connection(): Promise<InstagramConnectionStatus> {
    return this.login.status();
  }

  @Put(API_ROUTES.instagramApp)
  saveApp(@Body() body: unknown): Promise<SetInstagramAppResponse> {
    return this.login.saveApp(body);
  }

  /** Returns the URL to open and the prefix that marks arrival; the window itself is the desktop shell's job. */
  @Post(API_ROUTES.instagramLoginStart)
  startLogin(): Promise<StartInstagramLoginResponse> {
    return this.login.start();
  }

  /**
   * Meta sends the browser here after login. Answers with a small self-contained page rather than redirecting
   * onward: in development the screen lives on the dev server's port and when packaged it is served by this
   * process, so a backend that had to know where to send people back to would be one more thing to get wrong.
   * The page can be closed; the screen that started the login reads the connection status again.
   */
  @Get(API_ROUTES.instagramLoginCallback)
  @Header("content-type", "text/html; charset=utf-8")
  async completeLogin(@Query() query: Record<string, string | undefined>): Promise<string> {
    try {
      await this.login.complete(query);
      return loginResultPage("로그인이 완료되었습니다.", "이 창을 닫고 원래 화면으로 돌아가 주세요.");
    } catch {
      // Meta's own wording never reaches this page, and neither does ours beyond the two fixed lines — a login
      // page is exactly where a raw error message is most likely to be pasted somewhere it should not be.
      return loginResultPage("로그인을 완료하지 못했습니다.", "이 창을 닫고 다시 시도해 주세요.");
    }
  }

  /** Irreversible — the request must carry `approved: true` and the account the confirmation named. */
  @Post(`${API_ROUTES.projects}/:projectId/instagram/publish`)
  publish(@Param("projectId") projectId: string, @Body() body: unknown): Promise<PublishToInstagramResponse> {
    return this.publishing.publish(projectId, body);
  }

  @Delete(API_ROUTES.instagramConnection)
  signOut(): Promise<InstagramConnectionStatus> {
    return this.login.signOut();
  }
}
