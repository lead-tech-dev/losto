import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { AdminPrivacyController, FamilyPrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [PatientsModule],
  controllers: [FamilyPrivacyController, AdminPrivacyController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
