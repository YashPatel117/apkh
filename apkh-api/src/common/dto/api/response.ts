export class ApiResponseDto<T> {
  data: T;
  message: string;
  statusCode: number;

  ok(data: T): ApiResponseDto<T> {
    this.data = data;
    this.message = 'OK';
    this.statusCode = 200;
    return this;
  }

  error(message: string): ApiResponseDto<T> {
    this.message = message;
    this.statusCode = 500;
    return this;
  }
}
