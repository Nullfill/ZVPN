/**
 * Express 4 does not forward rejected route promises to error middleware.
 * Keep this wrapper tiny so controllers can remain plain async functions.
 */
export function asyncHandler(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

