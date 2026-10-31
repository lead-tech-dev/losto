import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Par défaut toutes les routes exigent une connexion. @Public() marque les exceptions (inscription, connexion...).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
