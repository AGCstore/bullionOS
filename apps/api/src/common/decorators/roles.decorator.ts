import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../db/types';

export const ROLES_KEY = 'roles';

/** Restricts a route to the listed roles (requires JwtAuthGuard + RolesGuard). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
