import { IsString, MaxLength } from 'class-validator';

/**
 * PROD-002 — edit the storage location label for a product's inventory
 * row. Service trims + clamps to 64 chars and collapses empty strings
 * to 'main', so the DTO validation here is intentionally lax — we want
 * to accept whatever the operator types and normalize server-side.
 */
export class SetInventoryLocationDto {
  @IsString()
  @MaxLength(64)
  location!: string;
}
