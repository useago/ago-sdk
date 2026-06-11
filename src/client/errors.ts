/**
 * Base error class for AGO SDK
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
    return new AgoApiError(
      error.message,
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
 */
export class AgoStreamError extends AgoError {
  constructor(message: string) {
    super(message, "stream_error");
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
