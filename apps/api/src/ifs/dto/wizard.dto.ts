import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * DTOs for the Phase 2 create-label wizard. One per IFS endpoint we
 * surface to the FE. Field names mirror IFS's own naming (snake_case)
 * so the service layer can pass them straight through to the form-data
 * builder without remapping.
 *
 * Validation philosophy: only the shape — IFS itself rejects bad
 * combinations (zip vs. service, weight vs. dim, declared > cap, etc.)
 * and returns specific error messages we surface to the FE. Adding
 * client-side equivalents here would just duplicate that source of
 * truth and drift over time.
 */

export class GetSenderDto {
  @IsString()
  @Length(1, 40)
  client_address_id!: string;
}

export class SearchRecipientsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  term?: string;
}

export class ServiceRestrictionDto {
  @IsString() @MaxLength(60) ca_country!: string;
  @IsString() @MaxLength(60) client_country!: string;
  @IsString() @MaxLength(60) service_type!: string;
  @IsString() @MaxLength(20) client_zip!: string;
}

export class VerifyAddressDto {
  @IsString() @MaxLength(255) client_address1!: string;
  @IsString() @MaxLength(60) client_country!: string;
  @IsString() @MaxLength(20) client_zip!: string;
  @IsOptional() @IsString() @MaxLength(40) recipient_id?: string;
  @IsOptional() @IsString() @MaxLength(255) client_company_name?: string;
  @IsOptional() @IsString() @MaxLength(255) client_address2?: string;
  @IsOptional() @IsString() @MaxLength(120) client_city?: string;
  @IsOptional() @IsString() @MaxLength(60) client_state?: string;
}

export class AcceptCorrectedAddressDto {
  @IsString() @MaxLength(40) recipient_id!: string;
  @IsString() @MaxLength(255) FAAddress!: string;
  @IsString() @MaxLength(120) FACity!: string;
  @IsString() @MaxLength(60) FAState!: string;
  @IsString() @MaxLength(20) FAZip!: string;
  @IsString() @MaxLength(60) FACountry!: string;
  @IsOptional() @IsString() @MaxLength(255) FACompanyName?: string;
  @IsOptional() @IsString() @MaxLength(255) FAAddress2?: string;
  @IsOptional() @IsInt() @Min(0) FAResidentialStatus?: number;
}

export class ZoneIdDto {
  @IsString() @MaxLength(20) recipient_zip!: string;
  @IsString() @MaxLength(60) recipient_country!: string;
  @IsString() @MaxLength(20) shipper_zip!: string;
  @IsString() @MaxLength(60) shipper_country!: string;
  @IsString() @MaxLength(60) service_type!: string;
  @IsOptional() @IsString() @MaxLength(255) recipient_address?: string;
  @IsOptional() @IsString() @MaxLength(120) recipient_city?: string;
  @IsOptional() @IsString() @MaxLength(60) recipient_state?: string;
  @IsOptional() @IsString() @MaxLength(255) shipper_address?: string;
  @IsOptional() @IsString() @MaxLength(120) shipper_city?: string;
  @IsOptional() @IsString() @MaxLength(60) shipper_state?: string;
}

export class PackagingRestrictionDto {
  @IsString() @MaxLength(60) packaging_type!: string;
}

export class CheckWeightDto {
  @IsString() @MaxLength(60) packaging_type!: string;
  @IsString() @MaxLength(60) service_type!: string;
  @IsNumber() @Min(0) package_weight!: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_length?: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_width?: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_height?: number;
}

export class CheckDeclareValueDto {
  @IsString() @MaxLength(60) service_type!: string;
  @IsString() @MaxLength(60) ca_country!: string;
  @IsString() @MaxLength(60) client_country!: string;
  @IsOptional() @IsNumber() @Min(0) declare_value?: number;
}

export class HoldForPickupDto {
  @IsString() @MaxLength(20) shipping_zip!: string;
  @IsString() @MaxLength(60) service_type!: string;
  @IsOptional() @IsString() @MaxLength(255) shipping_address?: string;
  @IsOptional() @IsString() @MaxLength(120) shipping_city?: string;
  @IsOptional() @IsString() @MaxLength(60) shipping_state?: string;
  @IsOptional() @IsString() @MaxLength(60) shipping_country?: string;
}

export class ShipmentDetailsDto {
  @IsOptional() @IsString() @MaxLength(40) shipment_id?: string;
  @IsOptional() @IsString() @MaxLength(80) tracking_no?: string;
}

export class VoidShipmentDto {
  @IsString() @MaxLength(40) shipment_id!: string;
}

/**
 * The full create-label / cost-preview payload. #20 and #26 take the
 * same shape, so one DTO covers both. Domestic-only happy path —
 * international + multi-ship + pickup-scheduling are deferred.
 */
export class LabelPayloadDto {
  // Sender
  @IsString() @MaxLength(255) ca_company_name!: string;
  @IsString() @MaxLength(255) ca_name!: string;
  @IsString() @MaxLength(255) ca_label_name!: string;
  @IsString() @MaxLength(255) ca_email!: string;
  @IsString() @MaxLength(255) ca_address1!: string;
  @IsOptional() @IsString() @MaxLength(255) ca_address2?: string;
  @IsString() @MaxLength(120) ca_city!: string;
  @IsString() @MaxLength(20) ca_zip!: string;
  @IsString() @MaxLength(60) ca_state!: string;
  @IsString() @MaxLength(10) ca_state_id!: string;
  @IsString() @MaxLength(60) ca_country!: string;
  @IsString() @MaxLength(40) ca_phone!: string;
  @IsOptional() @IsString() @MaxLength(40) ca_fax?: string;

  // Recipient
  @IsOptional() @IsString() @MaxLength(40) recipient_id?: string;
  @IsString() @MaxLength(255) client_label_name!: string;
  @IsString() @MaxLength(255) client_company_name!: string;
  @IsString() @MaxLength(255) client_name!: string;
  @IsString() @MaxLength(255) client_address1!: string;
  @IsOptional() @IsString() @MaxLength(255) client_address2?: string;
  @IsString() @MaxLength(120) client_city!: string;
  @IsString() @MaxLength(60) client_state!: string;
  @IsString() @MaxLength(10) client_state_id!: string;
  @IsString() @MaxLength(20) client_zip!: string;
  @IsString() @MaxLength(60) client_country!: string;
  @IsString() @MaxLength(40) client_phone!: string;
  @IsOptional() @IsString() @MaxLength(255) client_email?: string;
  @IsIn([0, 1]) client_is_address_verify!: 0 | 1;
  @IsIn([0, 1]) residential!: 0 | 1;

  // Package
  @IsString() @MaxLength(60) packaging_type!: string;
  @IsNumber() @Min(0) package_weight!: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_length?: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_width?: number;
  @IsOptional() @IsNumber() @Min(0) packaging_dim_height?: number;

  // Service
  @IsString() @MaxLength(60) service_type!: string;
  @IsInt() @Min(0) zone_id!: number;
  @IsString() @MaxLength(60) signature_type1!: string;
  @IsIn([0, 1]) saturday_delivery!: 0 | 1;
  // IFS expects MM-DD-YYYY for pickup_date.
  @IsString() @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'pickup_date must be MM-DD-YYYY',
  })
  pickup_date!: string;
  @IsNumber() @Min(0) declare_value!: number;

  // Hold-at-Location (optional)
  @IsOptional() @IsIn([0, 1]) hold_for_pu?: 0 | 1;
  @IsOptional() @IsInt() @Min(0) hal_selected_value?: number;
  @IsOptional() @IsString() @MaxLength(255) hal_company_name?: string;
  @IsOptional() @IsString() @MaxLength(255) hal_address?: string;
  @IsOptional() @IsString() @MaxLength(120) hal_city?: string;
  @IsOptional() @IsString() @MaxLength(60) hal_state?: string;
  @IsOptional() @IsString() @MaxLength(10) hal_state_id?: string;
  @IsOptional() @IsString() @MaxLength(20) hal_zip?: string;
  @IsOptional() @IsString() @MaxLength(60) hal_country?: string;
  @IsOptional() @IsString() @MaxLength(40) hal_phone?: string;
  @IsOptional() @IsString() @MaxLength(255) hal_contact_person?: string;
  @IsOptional() @IsString() @MaxLength(255) hal_location_property?: string;
  @IsOptional() @IsString() @MaxLength(500) hal_map_url?: string;
  @IsOptional() @IsString() @MaxLength(40) hal_distance?: string;
  @IsOptional() @IsString() @MaxLength(255) hal_email?: string;

  // Billing
  @IsIn(['SENDER', 'RECIPIENT', 'THIRD_PARTY'])
  payment_type!: 'SENDER' | 'RECIPIENT' | 'THIRD_PARTY';
  @IsOptional() @IsString() @MaxLength(40) account_number?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;

  // Reference / output
  @IsOptional() @IsString() @MaxLength(40) reference?: string;
  @IsOptional() @IsIn([0, 1]) reference_show_on_label?: 0 | 1;
  @IsString() @MaxLength(60) label_stock_type!: string;
  @IsIn([0, 1]) gen_label_save!: 0 | 1;
  @IsOptional() @IsIn([0, 1]) display_receipt?: 0 | 1;
}

/**
 * Wraps LabelPayloadDto for the create-label endpoint with an optional
 * invoice_id — present when the wizard was launched from an invoice
 * detail page so the resulting label gets linked back via the local
 * `shipments` table.
 */
export class CreateLabelDto {
  @IsOptional()
  @IsUUID()
  invoice_id?: string;

  @ValidateNested()
  @Type(() => LabelPayloadDto)
  payload!: LabelPayloadDto;
}
