/** Store usernames in lowercase so matching and unique-index checks are case-insensitive. */
exports.normalizeUsername = (value) => String(value || '').trim().toLowerCase();

/** Normalize Indian 10-digit numbers to +91; other numbers must be entered in E.164 form. */
exports.normalizePhone = (value) => {
  const input = String(value || '').trim();
  if (!input) return '';
  const compact = input.replace(/[\s()-]/g, '');
  if (/^[6-9]\d{9}$/.test(compact)) return `+91${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
};
