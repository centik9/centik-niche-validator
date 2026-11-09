export class HttpError extends Error {
  constructor(status, code, message, extra = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export class DataForSeoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DataForSeoError";
    this.code = code;
  }
}
