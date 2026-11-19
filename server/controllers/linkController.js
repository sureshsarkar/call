const asyncHandler = require('../utils/asyncHandler');
const { getLinkPreview } = require('../services/linkPreview');

exports.preview = asyncHandler(async (req, res) => {
  res.json({ preview: await getLinkPreview(req.query.url) });
});
