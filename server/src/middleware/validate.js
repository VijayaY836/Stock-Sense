/** Parse req.body / req.query with a zod schema; replaces them with the clean result. */
export const body = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};
export const query = (schema) => (req, _res, next) => {
  req.q = schema.parse(req.query ?? {});
  next();
};
