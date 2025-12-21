import Joi, { ObjectSchema } from 'joi';

const addReactionSchema: ObjectSchema = Joi.object().keys({
  userTo: Joi.string().required().messages({
    'any.required': 'userTo is a required property'
  }),
  postId: Joi.string().required().messages({
    'any.required': 'postId is a required property'
  }),
  commentId: Joi.string().optional().allow(null, '').messages({
    'any.required': 'commentId is optional for comment reactions'
  }),
  type: Joi.string().required().messages({
    'any.required': 'Reaction type is a required property'
  }),
  profilePicture: Joi.string().optional().allow(null, ''),
  previousReaction: Joi.string().optional().allow(null, ''),
  postReactions: Joi.object().optional().allow(null, '')
});

const removeReactionSchema: ObjectSchema = Joi.object().keys({
  postReactions: Joi.object().optional().allow(null, '')
});

export { addReactionSchema, removeReactionSchema };
