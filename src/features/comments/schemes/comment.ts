import Joi, { ObjectSchema } from 'joi';

const addCommentSchema: ObjectSchema = Joi.object().keys({
  userTo: Joi.string().required().messages({
    'any.required': 'userTo is a required property'
  }),
  postId: Joi.string().required().messages({
    'any.required': 'postId is a required property'
  }),
  // Comment can be optional if gifUrl is provided (for giphy comments)
  comment: Joi.string().optional().allow(null, ''),
  profilePicture: Joi.string().optional().allow(null, ''),
  gifUrl: Joi.string().optional().allow(null, ''),
  commentsCount: Joi.number().optional().allow(null, '')
}).custom((value, helpers) => {
  // At least one of comment or gifUrl must be provided and non-empty
  const hasComment = value.comment && value.comment.trim();
  const hasGif = value.gifUrl && value.gifUrl.trim();
  if (!hasComment && !hasGif) {
    return helpers.error('any.custom', {
      message: 'Either comment text or gifUrl must be provided'
    });
  }
  return value;
});

export { addCommentSchema };
