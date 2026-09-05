import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { INTERNAL_ERROR_CODE, type ApiError } from "@ai-animation-studio/shared";

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}


/**
 * Shapes the one kind of failure that was leaving this app without a code: an unexpected throw.
 *
 * Every deliberate refusal in this codebase is an `HttpException` carrying `{ code, message }`, and every
 * client guard reads that shape. Nothing shaped the rest. A route that threw something unplanned answered with
 * Nest's default `{ statusCode, message }`, which has no `code` at all — so the client could not tell a server
 * that failed from a server that was not there.
 *
 * 🔴 That distinction stopped being theoretical tonight. A thirteen-minute outage put two different sentences
 * on screen at once, because two client modules classify "5xx that is not our shape" as *the server is not
 * running* and the other sixteen call it a malformed response. Both readings were reasonable, and for a real
 * crash both are wrong: the server is up, and one route failed.
 *
 * With a code on it, a crash says it is a crash. The two modules that ask "is the server down" now correctly
 * answer no, and the sixteen that do not fall back to "the request could not be completed" — which is what
 * happened.
 *
 * `HttpException` is passed through byte for byte rather than re-shaped. Those are the answers this app means,
 * including Nest's own 404 and 413, and rewriting them here would move behaviour that every other test in this
 * repository already pins.
 *
 * The message deliberately says nothing about the cause. It reaches a person through the client's own code
 * table, and the exception's real text is logged rather than sent — a stack trace or a file path in a response
 * body is a leak, and a sentence guessed from an unknown failure is worse than the plain one.
 */
@Catch()
export class UnexpectedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("UnexpectedError");

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    const body: ApiError = { code: INTERNAL_ERROR_CODE, message: "The request could not be completed." };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
