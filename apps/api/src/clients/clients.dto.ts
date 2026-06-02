import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @IsIn(["owner", "admin", "member"])
  role?: string;
}

export class ChangeRoleDto {
  @IsString()
  @IsIn(["owner", "admin", "member"])
  role!: string;
}

export class SetRateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number | null;
}
