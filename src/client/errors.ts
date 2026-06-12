/**
 * Base error class for AGO SDK
 *
 * Error convention: every throw carries a stable `code` (snake_case), a
 * one-line fix hint in the message, and a doc URL/anchor when one exists.
 * `code` is the compatibility surface — match on it, never on message text,
 * which may be reworded in any release. The code registry lives in
 * docs/general/configuration.md#error-codes.
 */
export class AgoError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "AgoError";
  }
}

/**
 * Error from API response
 */
export class AgoApiError extends AgoError {
  constructor(
    message: string,
    code: string,
    statusCode: number,
    public type: string,
    public param?: string,
    public docUrl?: string
  ) {
    super(message, code, statusCode);
    this.name = "AgoApiError";
  }

  static fromResponse(data: ApiErrorResponse, statusCode: number): AgoApiError {
    const error = data.error;
    // Surface the doc link in the message itself: most developers see the
    // message string (console, logs) long before they inspect `docUrl`.
    const message = error.doc_url
      ? `${error.message} See ${error.doc_url}`
      : error.message;
    return new AgoApiError(
      message,
      error.code,
      statusCode,
      error.type,
      error.param,
      error.doc_url
    );
  }
}

export interface ApiErrorResponse {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
    doc_url?: string;
  };
}

/**
 * Network/connection error
 */
export class AgoNetworkError extends AgoError {
  constructor(message: string, public originalError?: Error) {
    super(message, "network_error");
    this.name = "AgoNetworkError";
  }
}

/**
 * SSE stream error
 *
 * `code` distinguishes failure classes without message parsing:
 * - `stream_no_body`: the response had no streamable body (usually a
 *   misconfigured endpoint or a proxy stripping the SSE stream)
 * - `stream_error` (default): the stream failed mid-flight
 */
export class AgoStreamError extends AgoError {
  constructor(message: string, code: string = "stream_error") {
    super(message, code);
    this.name = "AgoStreamError";
  }
}

/**
 * Function execution error
 */
export class AgoFunctionError extends AgoError {
  constructor(
    message: string,
    public functionName: string,
    public originalError?: Error
  ) {
    super(message, "function_error");
    this.name = "AgoFunctionError";
  }
}
