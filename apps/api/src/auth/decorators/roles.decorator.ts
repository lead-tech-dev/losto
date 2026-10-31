import { SetMetadata } from '@nestjs/common';
import { Role } from '../../db/schema';

export const ROLES_KEY = 'roles';

// @Roles(Role.ADMIN) : seuls ces rôles peuvent appeler la route.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
