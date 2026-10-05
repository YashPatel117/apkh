import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Request } from 'express';
import { Model } from 'mongoose';
import { User, UserDocument } from 'src/common/schema/user';

/** Admins are listed by email in ADMIN_EMAILS (comma-separated). */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | undefined | null): boolean {
  return Boolean(email) && adminEmails().has(email!.toLowerCase());
}

/** Runs after AuthGuard: lets only admins through. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = (request as unknown as { user?: { _id?: string } }).user;
    const user = payload?._id
      ? await this.userModel.findById(payload._id).select('email').lean()
      : null;
    if (!isAdminEmail(user?.email)) {
      throw new ForbiddenException('Admins only');
    }
    return true;
  }
}
