import Joi, { ObjectSchema } from 'joi';

const signupSchema: ObjectSchema = Joi.object().keys({
  username: Joi.string()
    .required()
    .min(3)
    .max(30)
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .messages({
      'string.base': 'Username must be of type string',
      'string.pattern.base': 'Username can only contain letters, numbers, underscores, and hyphens',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username must be no more than 30 characters',
      'string.empty': 'Username is a required field'
    }),
  password: Joi.string()
    .required()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .messages({
      'string.base': 'Password must be of type string',
      'string.min': 'Password must be at least 8 characters',
      'string.max': 'Password must be no more than 128 characters',
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)',
      'string.empty': 'Password is a required field'
    }),
  email: Joi.string().required().email().messages({
    'string.base': 'Email must be of type string',
    'string.email': 'Email must be valid',
    'string.empty': 'Email is a required field'
  }),
  avatarColor: Joi.string().optional().messages({
    'string.base': 'Avatar color must be of type string'
  }),
  avatarImage: Joi.string().required().messages({
    'any.required': 'Avatar image is required'
  })
});

export { signupSchema };
