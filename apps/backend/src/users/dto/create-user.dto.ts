import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsUzPhone, SanitizedText } from '../../common/validation/index.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  IsAcceptablePassword,
  PASSWORD_MAX_LENGTH,
} from '../password-policy.js';

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 100;
export const EMAIL_MAX = 254;

/**
 * A phone, a Google email, or both. A phone account signs in with phone +
 * password (so the password is required with a phone); an email account
 * signs in with that Google account.
 */
export class CreateUserDto {
  @ApiPropertyOptional({
    example: '+998901234567',
    description: 'Telefon yoki email (yoki ikkalasi) majburiy',
  })
  @ValidateIf((dto: CreateUserDto) => dto.phone !== undefined || !dto.email)
  @IsString()
  @MaxLength(32)
  @IsUzPhone()
  phone?: string;

  @ApiPropertyOptional({
    example: 'fermer@gmail.com',
    description:
      'Google akkaunti emaili: foydalanuvchi shu akkaunt bilan kiradi',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(EMAIL_MAX)
  @IsEmail({}, { message: 'Email manzili noto‘g‘ri' })
  email?: string;

  @ApiProperty({ minLength: FULL_NAME_MIN, maxLength: FULL_NAME_MAX })
  @SanitizedText()
  @IsString()
  @MinLength(FULL_NAME_MIN)
  @MaxLength(FULL_NAME_MAX)
  fullName: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    format: 'password',
    maxLength: PASSWORD_MAX_LENGTH,
    description: 'Telefon bilan kirish uchun majburiy',
  })
  @ValidateIf(
    (dto: CreateUserDto) =>
      dto.phone !== undefined || dto.password !== undefined,
  )
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @IsAcceptablePassword()
  password?: string;
}
