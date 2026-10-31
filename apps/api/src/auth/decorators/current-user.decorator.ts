import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../../db/schema';

// Ce que contient le jeton une fois vérifié.
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

// @CurrentUser() user : récupère l'utilisateur connecté dans un contrôleur.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
