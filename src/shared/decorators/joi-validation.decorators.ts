import { JoiRequestedValidationError } from '@global/helpers/error-handler';
import { Request } from 'express';
import { ObjectSchema } from 'joi';
import Logger from 'bunyan';
import { config } from '@root/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IJoiDecorator = (target: any, key: string, descriptor: PropertyDescriptor) => void;

const log: Logger = config.createLogger('joiValidation');

export function joiValidation(schema: ObjectSchema): IJoiDecorator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (_target: any, _key: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = async function (...args: any[]) {
      const req: Request = args[0];
      const validationOptions = {
        abortEarly: false,
        allowUnknown: true,
        stripUnknown: false
      };
      const { error, value } = await Promise.resolve(schema.validate(req.body, validationOptions));

      if (error?.details) {
        // Log validation errors for debugging
        log.error(`[Validation Error] ${req.method} ${req.path}`, {
          errors: error.details.map((d) => ({ message: d.message, path: d.path })),
          bodyKeys: Object.keys(req.body || {}),
          bodySample: JSON.stringify(req.body).substring(0, 500),
          url: req.originalUrl
        });
        throw new JoiRequestedValidationError(error.details.map((d) => d.message).join('; '));
      }

      // Replace req.body with validated/sanitized value
      req.body = value;
      return originalMethod.apply(this, args);
    };
    return descriptor;
  };
}
