import { JoiRequestedValidationError } from '@global/helpers/error-handler';
import { Request } from 'express';
import { ObjectSchema } from 'joi';

type IJoiDecorator = (target: any, key: string, descriptor: PropertyDescriptor) => void;

export function joiValidation(schema: ObjectSchema): IJoiDecorator {
  return  (_target: any, _key: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const req: Request = args[0];
      // Add timeout protection for validation to prevent hanging
      try {
        const validationPromise = Promise.resolve(schema.validate(req.body, { abortEarly: false, allowUnknown: true }));
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Validation timeout'));
          }, 2000); // 2 second timeout for validation
        });
        
        const { error } = await Promise.race([validationPromise, timeoutPromise]);
        if (error?.details) {
          throw new JoiRequestedValidationError(error.details[0].message);
        }
      } catch (validationError) {
        // If it's already a JoiRequestedValidationError, rethrow it
        if (validationError instanceof JoiRequestedValidationError) {
          throw validationError;
        }
        // If it's a timeout error, throw validation error
        if (validationError instanceof Error && validationError.message === 'Validation timeout') {
          throw new JoiRequestedValidationError('Validation timeout - request took too long to validate');
        }
        // Otherwise, rethrow the original error
        throw validationError;
      }
      return originalMethod.apply(this, args);
    };
    return descriptor;
  };
}
