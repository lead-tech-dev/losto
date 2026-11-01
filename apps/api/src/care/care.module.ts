import { Module } from '@nestjs/common';
import { AdminCareController, AvailabilityController, DoctorController, NurseController } from './care.controller';
import { CareTeamService } from './care-team.service';
import { ClinicalAccessService } from './clinical-access.service';
import { DoctorService } from './doctor.service';
import { NurseService } from './nurse.service';
import { ReadingsService } from './readings.service';
import { SchedulingService } from './scheduling.service';

@Module({
  controllers: [AvailabilityController, DoctorController, NurseController, AdminCareController],
  providers: [CareTeamService, ClinicalAccessService, SchedulingService, ReadingsService, DoctorService, NurseService],
  exports: [SchedulingService, ReadingsService],
})
export class CareModule {}
