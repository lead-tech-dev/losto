import { Module } from '@nestjs/common';
import { CoverageModule } from '../coverage/coverage.module';
import { ConsentService } from './consent.service';
import { FamilyService } from './family.service';
import { PatientAccessService } from './patient-access.service';
import { PatientRecordsService } from './patient-records.service';
import { ConsentController, InvitationsController, PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({
  imports: [CoverageModule],
  controllers: [PatientsController, InvitationsController, ConsentController],
  providers: [PatientsService, PatientAccessService, PatientRecordsService, FamilyService, ConsentService],
  exports: [PatientAccessService],
})
export class PatientsModule {}
