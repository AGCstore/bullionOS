import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // NIST-style: length > composition. We require 12+ chars and at least one letter + one number.
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(200)
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter' })
  @Matches(/[0-9]/, { message: 'Password must contain a number' })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  first_name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  last_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
