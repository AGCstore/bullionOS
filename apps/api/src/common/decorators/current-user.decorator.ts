import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../db/types';

export interface RequestUser {
  id: string;
  email: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);
