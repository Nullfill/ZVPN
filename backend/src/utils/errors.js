export const ERROR_MESSAGES = {
  INVALID_INPUT: 'ورودی نامعتبر است.',
  INVALID_CREDENTIALS: 'نام کاربری یا رمز عبور درست نیست.',
  UNAUTHORIZED: 'لطفاً دوباره وارد شوید.',
  NOT_FOUND: 'مورد درخواستی یافت نشد.',
  USERNAME_EXISTS: 'این نام کاربری قبلاً ثبت شده است.',
  BAD_PASSWORD: 'رمز فعلی صحیح نیست.',
  SYNC_FAILED: 'تغییرات ذخیره شد اما همگام‌سازی VPN با تأخیر انجام می‌شود.',
  PROVISIONING_FAILED: 'ساخت کاربر ناقص ماند.',
  TOKEN_REVOKED: 'لینک دانلود غیرفعال شده است.',
  ENDPOINT_USE_WIZARD: 'تغییر Endpoint VPN فقط از بخش «مدیریت Endpoint» انجام می‌شود.',
  CERT_CONFIRM_REQUIRED: 'برای Endpoint جدید باید ساخت گواهی جدید را تأیید کنید.',
  DNS_FAILED: 'دامنه resolve نمی‌شود. DNS را بررسی کنید.',
  UNCHANGED: 'Endpoint تغییری نکرده است.',
  HEALTH_FAILED: 'تغییرات اعمال شد اما health check کامل موفق نبود.',
  INVALID_ENDPOINT: 'Endpoint نامعتبر است.',
  HELPER_FAILED: 'عملیات سرور VPN ناموفق بود.',
  INTERNAL_ERROR: 'خطای داخلی سرور.',
};

Object.assign(ERROR_MESSAGES, {
  FORBIDDEN: 'You do not have permission to perform this action.',
  INVALID_CONTENT_TYPE: 'Content-Type must be application/json.',
  REQUEST_TOO_LARGE: 'The request body is too large.',
});

export class AppError extends Error {
  constructor(status, code, { message, details, cause } = {}) {
    super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export function translateError(code, details) {
  if (code === 'INVALID_INPUT' && details?.fieldErrors) {
    const f = details.fieldErrors;
    if (f.password?.[0]) return 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
    if (f.username?.[0]) return 'نام کاربری نامعتبر است.';
  }
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR;
}

export function endpointError(res, err) {
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || translateError(code);
  return res.status(code === 'CERT_CONFIRM_REQUIRED' ? 409 : 400).json({ error: code, message });
}

export function apiError(res, status, code, details) {
  return res.status(status).json({
    error: code,
    message: translateError(code, details),
    ...(details ? { details } : {}),
    ...(res.req?.id ? { requestId: res.req.id } : {}),
  });
}

export function notFoundHandler(req, res) {
  return apiError(res, 404, 'NOT_FOUND');
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err?.type === 'entity.too.large') {
    return apiError(res, 413, 'REQUEST_TOO_LARGE');
  }
  if (err?.type === 'entity.parse.failed') {
    return apiError(res, 400, 'INVALID_INPUT');
  }

  const status = err instanceof AppError ? err.status : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
  const details = err instanceof AppError && err.expose ? err.details : undefined;
  if (status >= 500) {
    console.error('[http.error]', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      error: err?.message,
      stack: err?.stack,
    });
  }
  return apiError(res, status, code, details);
}
