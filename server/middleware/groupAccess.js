const Group = require('../models/Group');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { getRuntimeConfig } = require('../services/runtimeConfig');

module.exports = asyncHandler(async (req, _res, next) => {
  if (getRuntimeConfig().features.groupChat === false) throw new ApiError(503, 'Group chat is temporarily disabled');
  const group = await Group.findOne({ _id: req.params.groupId, 'members.user': req.user._id }).select('_id');
  if (!group) throw new ApiError(404, 'Group not found');
  req.groupId = group._id;
  next();
});
