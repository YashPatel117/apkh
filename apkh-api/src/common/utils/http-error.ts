import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Normalises a caught error for rethrowing: existing HttpExceptions keep their
 * status and message, anything else becomes `status` with a readable message.
 */
export function toHttpException(
  error: unknown,
  status: HttpStatus = HttpStatus.BAD_REQUEST,
): HttpException {
  if (error instanceof HttpException) return error;
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'An unexpected error occurred';
  return new HttpException(message, status);
}
