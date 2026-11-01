import { Module } from '@nestjs/common';
import { AdminMessagesController, MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController, AdminMessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
