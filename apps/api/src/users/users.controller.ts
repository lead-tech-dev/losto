import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role, ROLES } from '../db/schema';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { UsersService } from './users.service';

// Gestion des comptes : réservée à l'équipe Proche Santé.
@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateStaffDto) {
    return this.users.createStaff(actor.id, dto);
  }

  @Get()
  list(@Query('role') role?: string) {
    if (role !== undefined && !(ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException('Rôle inconnu');
    }
    return this.users.list(role as Role | undefined);
  }

  @Patch(':id/active')
  setActive(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.users.setActive(actor.id, id, dto.isActive);
  }

  @Patch(':id/verify')
  verify(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.verifyPartner(actor.id, id);
  }
}
