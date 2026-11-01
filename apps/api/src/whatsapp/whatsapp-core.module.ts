import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaWhatsApp, SimulatedWhatsApp, WhatsAppGateway } from './gateway';
import { WhatsAppService } from './whatsapp.service';

// Envoi WhatsApp, disponible partout (notifications aux familles, code de livraison, bienvenue…)
@Global()
@Module({
  providers: [
    WhatsAppService,
    {
      // Les tests remplacent cette classe par une version qui enregistre les envois
      provide: WhatsAppGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const simulate = config.get('WHATSAPP_SIMULATION') === 'true';
        if (simulate && process.env.NODE_ENV === 'production') throw new Error('WHATSAPP_SIMULATION est interdit en production');
        return simulate ? new SimulatedWhatsApp() : new MetaWhatsApp(config);
      },
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppCoreModule {}
