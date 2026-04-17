import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  /**
   * 6-digit TOTP code OR a recovery code (xxxx-xxxx-xxxx = 14 chars).
   * Required once 2FA is enabled.
   */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  totp?: string;
}
