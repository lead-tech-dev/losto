import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères' })
  @MaxLength(72)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Le nouveau mot de passe doit faire au moins 8 caractères' })
  @MaxLength(72)
  newPassword: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @Matches(/^(\+?[0-9 ]{8,20})?$/, { message: 'Numéro de téléphone invalide' })
  phone?: string;
}
