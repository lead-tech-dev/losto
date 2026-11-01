import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LabService } from './lab.service';
import { PharmacyService } from './pharmacy.service';

// Rattrapage quotidien : livraisons et analyses restées sans livreur ou sans laboratoire
@Injectable()
export class LogisticsCronService {
  private readonly logger = new Logger(LogisticsCronService.name);

  constructor(
    private readonly pharmacy: PharmacyService,
    private readonly lab: LabService,
  ) {}

  @Cron('30 7 * * *', { timeZone: 'Africa/Douala' })
  async daily() {
    const summary = { deliveries: await this.pharmacy.assignPendingDeliveries(), labs: await this.lab.assignPending() };
    this.logger.log(`Affectations rattrapées : ${JSON.stringify(summary)}`);
    return summary;
  }
}
