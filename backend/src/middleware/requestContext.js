import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.id);

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

