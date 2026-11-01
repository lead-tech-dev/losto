import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { NotifyService } from './notify.service';

@Global()
@Module({
  providers: [MailerService, NotifyService],
  exports: [MailerService, NotifyService],
})
export class MailModule {}
