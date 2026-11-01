import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CAMEROON_PHONE } from '../../common/text';
import { CITIES, City, Condition, CONDITIONS, Plan, PLANS, READING_TYPES, ReadingType } from '../../db/schema';

const THIS_YEAR = new Date().getFullYear();

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(THIS_YEAR)
  birthYear?: number;

  @Matches(CAMEROON_PHONE, { message: 'Numéro WhatsApp camerounais invalide (ex. 6 77 12 34 56)' })
  whatsappPhone: string;

  @IsBoolean()
  hasSmartphone: boolean;

  @IsIn(CITIES, { message: 'Ville inconnue' })
  city: City;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  district: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressDetails?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Choisissez au moins une maladie à suivre' })
  @ArrayMaxSize(CONDITIONS.length)
  @ArrayUnique()
  @IsIn(CONDITIONS, { each: true, message: 'Maladie inconnue' })
  conditions: Condition[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  medicalHistory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  currentTreatments?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsIn(PLANS, { message: 'Formule inconnue' })
  plan: Plan;
}

// Mêmes règles, tout facultatif : on n'envoie que ce qui change. La formule a sa propre route.
export class UpdatePatientDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;
  @IsOptional() @IsInt() @Min(1900) @Max(THIS_YEAR) birthYear?: number;
  @IsOptional()
  @Matches(CAMEROON_PHONE, { message: 'Numéro WhatsApp camerounais invalide (ex. 6 77 12 34 56)' })
  whatsappPhone?: string;
  @IsOptional() @IsBoolean() hasSmartphone?: boolean;
  @IsOptional() @IsIn(CITIES, { message: 'Ville inconnue' }) city?: City;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) district?: string;
  @IsOptional() @IsString() @MaxLength(300) addressDetails?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choisissez au moins une maladie à suivre' })
  @ArrayUnique()
  @IsIn(CONDITIONS, { each: true, message: 'Maladie inconnue' })
  conditions?: Condition[];
  @IsOptional() @IsString() @MaxLength(2000) medicalHistory?: string;
  @IsOptional() @IsString() @MaxLength(2000) currentTreatments?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}


export class InviteDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  email: string;
}

export class ReadingsQueryDto {
  @IsIn(READING_TYPES, { message: 'Type de relevé inconnu' })
  type: ReadingType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days?: number;
}
