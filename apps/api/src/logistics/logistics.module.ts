import { Module } from '@nestjs/common';
import { CareModule } from '../care/care.module';
import { CourierService } from './courier.service';
import { LabService } from './lab.service';
import { LogisticsCronService } from './logistics-cron.service';
import {
  AdminDeliveriesController,
  CourierController,
  DoctorLabController,
  LabController,
  PharmacyController,
} from './logistics.controller';
import { PharmacyService } from './pharmacy.service';

@Module({
  imports: [CareModule],
  controllers: [PharmacyController, LabController, DoctorLabController, CourierController, AdminDeliveriesController],
  providers: [PharmacyService, LabService, CourierService, LogisticsCronService],
})
export class LogisticsModule {}
