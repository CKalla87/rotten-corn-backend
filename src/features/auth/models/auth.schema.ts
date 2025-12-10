import { hash, compare } from 'bcryptjs';
import { IAuthDocument } from '@auth/interfaces/auth.interface';
import { model, Model, Schema } from 'mongoose';

const SALT_ROUND = 10;

const authSchema: Schema = new Schema(
  {
    username: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true,
      lowercase: true, // Automatically lowercase
      trim: true // Remove whitespace
    },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true,
      lowercase: true, // Automatically lowercase
      trim: true // Remove whitespace
    },
    uId: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true 
    },
    password: { type: String },
    avatarColor: { type: String },
    createdAt: { type: Date, default: Date.now },
    passwordResetToken: { type: String, default: '' },
    passwordResetExpires: { type: Number },
    oauth: {
      google: {
        id: { type: String },
        email: { type: String }
      },
      github: {
        id: { type: String },
        username: { type: String }
      },
      facebook: {
        id: { type: String },
        email: { type: String }
      }
    }
  },
  {
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        return ret;
      }
    }
  }
);

authSchema.pre('save', async function (this: IAuthDocument, next: () => void) {
  // Only hash password if it exists, is modified, and is not already hashed
  if (!this.password || !this.isModified('password')) {
    return next();
  }
  // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
  if (this.password.startsWith('$2')) {
    return next();
  }
  const hashedPassword: string = await hash(this.password as string, SALT_ROUND);
  this.password = hashedPassword;
  next();
});

authSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  const hashedPassword: string = (this as unknown as IAuthDocument).password!;
  return compare(password, hashedPassword);
};

authSchema.methods.hashPassword = async function (password: string): Promise<string> {
  return hash(password, SALT_ROUND);
};

const AuthModel: Model<IAuthDocument> = model<IAuthDocument>('Auth', authSchema, 'Auth');
export { AuthModel };
