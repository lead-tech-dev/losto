import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CITIES, City, Role } from '../../db/schema';

// Rôles que l'admin peut créer. FAMILY est exclu : les familles s'inscrivent elles-mêmes.
export const STAFF_ROLES = [Role.DOCTOR, Role.NURSE, Role.PHARMACY, Role.COURIER, Role.ADMIN] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export class CreateStaffDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsIn(STAFF_ROLES, { message: 'Rôle non autorisé' })
  role: StaffRole;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{8,20}$/, { message: 'Numéro de téléphone invalide' })
  phone?: string;

  // Champs du profil partenaire (ignorés pour un admin)
  @IsOptional()
  @IsIn(CITIES, { message: 'Ville inconnue' })
  city?: City;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  licenseNumber?: string;
}
