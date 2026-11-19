// Strips keys starting with "$" or containing "." (NoSQL operator injection). Mutates in place (Express 5 safe).
function clean(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) delete obj[key];
    else clean(obj[key], depth + 1);
  }
}

module.exports = (req, _res, next) => {
  clean(req.body);
  clean(req.query);
  clean(req.params);
  next();
};
