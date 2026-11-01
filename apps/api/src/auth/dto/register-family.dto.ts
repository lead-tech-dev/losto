import { Equals, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterFamilyDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe doit faire au moins 8 caractères' })
  @MaxLength(72) // limite de l'algorithme bcrypt
  password: string;

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

  // Conditions générales et politique de confidentialité acceptées (case cochée à l'inscription)
  @Equals(true, { message: 'Acceptez les conditions générales et la politique de confidentialité' })
  acceptTerms: boolean;
}
