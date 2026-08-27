import { Body, Controller, Delete, Get, Header, Logger, type LoggerService, Optional, Param, Post, Put, Query } from "@nestjs/common";
import {
  API_ROUTES, type ApiError, type CompleteInstagramLoginResponse,
  type GetInstagramTargetsResponse, type InstagramConnectionStatus,
  type PublishToInstagramResponse,
  type SetInstagramAppResponse, type SetInstagramTargetResponse, type StartInstagramLoginResponse,
} from "@ai-animation-studio/shared";

import { InstagramApiException } from "./instagram-api.error.js";
import { InstagramLoginService } from "./instagram-login.service.js";
import { InstagramPublishService } from "./instagram-publish.service.js";
import { InstagramTargetsService } from "./instagram-targets.service.js";

/**
 * Names the failure for the server console, because the page deliberately refuses to.
 *
 * Only fixed vocabulary is allowed through: the error code, the provider category, and the message, all of
 * which are strings this codebase wrote (`InstagramAdapterError` keeps Meta's own text in `detail`, which never
 * reaches the exception). The query is never named in any form — `code` and `state` are the two values in this
 * whole flow that must not be written down anywhere, and a log line is the easiest place to leak them by
 * accident, because it never looks like output.
 */
function describeLoginFailure(error: unknown): string {
  if (!(error instanceof InstagramApiException)) return "unrecognised error";
  const body = error.getResponse() as ApiError;
  const details = body.details as { category?: unknown; diagnostics?: unknown } | undefined;
  const category = details?.category;
  const head = typeof category === "string" ? `${body.code} (${category}): ${body.message}` : `${body.code}: ${body.message}`;
  return `${head}${describeDiagnostics(details?.diagnostics)}`;
}

/**
 * The numbers the category was derived from, appended so a wrong-looking category can be told from a real one.
 *
 * Numbers only, and only ones this app already reads to classify with — the fixed-vocabulary rule above is
 * unchanged, since an HTTP status and a Graph error code carry nothing of Meta's wording and nothing of the
 * login. Without them a category is an assertion with no way to check it, which is how a login refused over a
 * credential came to be reported as a Meta outage and left the person waiting for it to pass.
 */
function describeDiagnostics(diagnostics: unknown): string {
  if (typeof diagnostics !== "object" || diagnostics === null) return "";
  const parts = Object.entries(diagnostics)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, value]) => `${name}=${value}`);
  return parts.length ? ` [${parts.join(", ")}]` : "";
}

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
    // `@Optional()` is load-bearing, not decoration: this parameter's type is an interface, which reflects as
    // `Object`, and without it Nest tries to resolve that and aborts the process at bootstrap rather than
    // failing a test — the shape that already cost this repo a day of chasing "worker exited unexpectedly".
    // Nest then passes `undefined`, which is exactly what makes the default apply.
    @Optional() private readonly logger: Pick<LoggerService, "warn"> = new Logger("InstagramLogin"),
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

  /**
   * Returns the URL to open, and — for the desktop flow only — the prefix that marks the window's arrival.
   *
   * The body carries which flow to use, because only the caller knows whether it can read the URL its window
   * landed on: a browser tab cannot, a desktop shell can (D-022).
   */
  @Post(API_ROUTES.instagramLoginStart)
  startLogin(@Body() body: unknown): Promise<StartInstagramLoginResponse> {
    return this.login.start(body);
  }

  /** Takes the URL the desktop login window landed on, whole and unparsed — the code is read and the state checked here. */
  @Post(API_ROUTES.instagramLoginComplete)
  completeLoginFromRedirect(@Body() body: unknown): Promise<CompleteInstagramLoginResponse> {
    return this.login.completeFromRedirect(body);
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
    } catch (error) {
      // The page says nothing about why, so the console has to. Without this the only route whose reason is
      // deliberately withheld from the person is also the only one that records nothing anywhere, and the two
      // most likely failures are indistinguishable from outside: `nest start --watch` restarting mid-login
      // (the issued state lives in memory and is gone), and Meta refusing the exchange.
      this.logger.warn(`Instagram login callback failed — ${describeLoginFailure(error)}`);
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
