import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { READING_TYPES, ReadingType, REFERRAL_URGENCIES } from '../../db/schema';

export class SlotDto {
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(24 * 60) startMinute: number;
  @IsInt() @Min(0) @Max(24 * 60) endMinute: number;
}

export class AvailabilityDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SlotDto)
  slots: SlotDto[];
}

export class ReadingDto {
  @IsIn(READING_TYPES) type: ReadingType;
  @IsOptional() @IsInt() systolic?: number;
  @IsOptional() @IsInt() diastolic?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) value?: number;
}

export class PrescriptionItemDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(200) dosage?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) durationDays?: number;
}

export class ReferralDto {
  @IsString() @MinLength(2) @MaxLength(200) destination: string;
  @IsIn(REFERRAL_URGENCIES) urgency: (typeof REFERRAL_URGENCIES)[number];
  @IsString() @MinLength(2) @MaxLength(1000) reason: string;
}

export class LabRequestDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) tests: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// Fin de consultation : un seul envoi avec tout ce que le médecin a décidé
export class CompleteConsultationDto {
  @IsString()
  @MinLength(10, { message: 'Le compte rendu doit faire au moins quelques mots' })
  @MaxLength(5000)
  summary: string;

  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => ReadingDto)
  readings?: ReadingDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PrescriptionItemDto)
  prescription?: PrescriptionItemDto[];

  @IsOptional() @ValidateNested() @Type(() => LabRequestDto)
  labs?: LabRequestDto;

  @IsOptional() @ValidateNested() @Type(() => ReferralDto)
  referral?: ReferralDto;
}

export class MissedDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class RescheduleDto {
  @IsDateString() scheduledAt: string;
}

export class ExtraConsultationDto {
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsIn(['VIDEO', 'PHONE']) mode?: 'VIDEO' | 'PHONE';
}

export class CompleteVisitDto {
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => ReadingDto)
  readings: ReadingDto[];

  @IsBoolean() treatmentChecked: boolean;

  @IsString() @MinLength(3) @MaxLength(3000) note: string;
}

export class AckAlertDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CareTeamDto {
  @IsOptional() @IsString() doctorId?: string | null;
  @IsOptional() @IsString() nurseId?: string | null;
  @IsOptional() @IsString() pharmacyId?: string | null;
}
