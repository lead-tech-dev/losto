import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../db/schema';
import { MessagesService } from './messages.service';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'Le message est vide' })
  @MaxLength(4000)
  body: string;
}

@Roles(Role.FAMILY)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  thread(@CurrentUser() u: AuthUser) {
    return this.messages.familyThread(u.id);
  }

  @Get('unread')
  unread(@CurrentUser() u: AuthUser) {
    return this.messages.familyUnread(u.id);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post()
  send(@CurrentUser() u: AuthUser, @Body() dto: SendMessageDto) {
    return this.messages.familySend(u.id, dto.body);
  }
}

@Roles(Role.ADMIN)
@Controller('admin/messages')
export class AdminMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  threads() {
    return this.messages.threads();
  }

  @Get(':familyUserId')
  thread(@CurrentUser() u: AuthUser, @Param('familyUserId', ParseUUIDPipe) familyUserId: string) {
    return this.messages.teamThread(u.id, familyUserId);
  }

  @Post(':familyUserId')
  send(
    @CurrentUser() u: AuthUser,
    @Param('familyUserId', ParseUUIDPipe) familyUserId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.teamSend(u.id, familyUserId, dto.body);
  }
}
