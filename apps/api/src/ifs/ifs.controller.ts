import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { IfsService } from './ifs.service';
import {
  AcceptCorrectedAddressDto,
  CheckDeclareValueDto,
  CheckWeightDto,
  CreateLabelDto,
  GetSenderDto,
  HoldForPickupDto,
  LabelPayloadDto,
  PackagingRestrictionDto,
  SearchRecipientsDto,
  ServiceRestrictionDto,
  ShipmentDetailsDto,
  VerifyAddressDto,
  VoidShipmentDto,
  ZoneIdDto,
} from './dto/wizard.dto';

/**
 * Admin-only IFS surface.
 *
 *   GET  /admin/ifs/state                 — last-sync metadata
 *   GET  /admin/ifs/shipments?q=…         — flat list (search optional)
 *   POST /admin/ifs/sync                  — manual refresh (currently broken — no list endpoint)
 *
 *   --- Phase 2: create-label wizard ---
 *   GET  /admin/ifs/basic-data            — enum dropdowns (#2)
 *   GET  /admin/ifs/senders               — saved sender list (#3)
 *   POST /admin/ifs/senders/get           — hydrate one sender (#4)
 *   GET  /admin/ifs/recipients?term=…     — recipient typeahead (#5)
 *   POST /admin/ifs/service-restriction   — ZIP/service compat (#8)
 *   POST /admin/ifs/verify-address        — FedEx address verify (#9)
 *   POST /admin/ifs/accept-corrected      — accept FedEx-corrected address (#11)
 *   POST /admin/ifs/zone                  — compute zone_id (#13)
 *   POST /admin/ifs/packaging-restriction — service-by-packaging (#14)
 *   POST /admin/ifs/check-weight          — weight/dim validation (#16)
 *   POST /admin/ifs/check-declare-value   — insurance popup tree (#17)
 *   POST /admin/ifs/hold-for-pickup       — HAL locations (#19)
 *   POST /admin/ifs/calculate-cost        — cost preview (#20)
 *   POST /admin/ifs/labels                — create label (#26)
 *   POST /admin/ifs/shipment-details      — refresh by id/tracking (#28)
 *   POST /admin/ifs/void                  — void shipment (#31)
 */
@Controller('admin/ifs')
@Roles('admin', 'staff')
export class IfsController {
  constructor(private readonly ifs: IfsService) {}

  // ----- Phase 1 (read-only dashboard mirror; sync is currently broken) -----

  @Get('state')
  state() {
    return this.ifs.getSyncState();
  }

  @Get('shipments')
  shipments(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.ifs.listShipments({
      search: q,
      limit: limit ? Math.min(1000, Math.max(1, Number(limit))) : undefined,
    });
  }

  @Post('sync')
  @HttpCode(200)
  @Roles('admin')
  sync() {
    return this.ifs.runSync();
  }

  /**
   * Manual trigger for the IFS-side status refresh. Walks every
   * non-terminal ifs_shipments row and asks IFS for the current
   * FedEx status, propagating to the linked shipments row when one
   * exists. Useful when the operator just created a label and wants
   * to see status without waiting for the next 15-min cron tick.
   */
  @Post('refresh-status')
  @HttpCode(200)
  refreshStatus() {
    return this.ifs.runStatusRefresh();
  }

  // ----- Phase 2: create-label wizard -----

  @Get('basic-data')
  basicData() {
    return this.ifs.getBasicData();
  }

  @Get('senders')
  listSenders() {
    return this.ifs.listSenders();
  }

  @Post('senders/get')
  @HttpCode(200)
  getSender(@Body() dto: GetSenderDto) {
    return this.ifs.getSender(dto.client_address_id);
  }

  @Get('recipients')
  searchRecipients(@Query() dto: SearchRecipientsDto) {
    return this.ifs.searchRecipients(dto.term ?? '');
  }

  @Post('service-restriction')
  @HttpCode(200)
  serviceRestriction(@Body() dto: ServiceRestrictionDto) {
    return this.ifs.getServiceRestriction(dto);
  }

  @Post('verify-address')
  @HttpCode(200)
  verifyAddress(@Body() dto: VerifyAddressDto) {
    return this.ifs.verifyRecipientAddress(dto);
  }

  @Post('accept-corrected')
  @HttpCode(200)
  acceptCorrected(@Body() dto: AcceptCorrectedAddressDto) {
    return this.ifs.acceptCorrectedAddress(dto);
  }

  @Post('zone')
  @HttpCode(200)
  zone(@Body() dto: ZoneIdDto) {
    return this.ifs.getZoneId(dto);
  }

  @Post('packaging-restriction')
  @HttpCode(200)
  packagingRestriction(@Body() dto: PackagingRestrictionDto) {
    return this.ifs.getServiceTypesForPackage(dto.packaging_type);
  }

  @Post('check-weight')
  @HttpCode(200)
  checkWeight(@Body() dto: CheckWeightDto) {
    return this.ifs.checkWeight(dto);
  }

  @Post('check-declare-value')
  @HttpCode(200)
  checkDeclareValue(@Body() dto: CheckDeclareValueDto) {
    return this.ifs.checkDeclareValue(dto);
  }

  @Post('hold-for-pickup')
  @HttpCode(200)
  holdForPickup(@Body() dto: HoldForPickupDto) {
    return this.ifs.getHoldForPickupLocations(dto);
  }

  @Post('calculate-cost')
  @HttpCode(200)
  calculateCost(@Body() dto: LabelPayloadDto) {
    return this.ifs.calculateCost(dto);
  }

  /**
   * Create a label. Wizard sends the full LabelPayloadDto plus an
   * optional invoice_id (when launched from an invoice detail page).
   * On success we persist to ifs_shipments + (when invoice_id present)
   * the local `shipments` table so the label appears alongside other
   * carriers' tracking on the invoice detail page.
   */
  @Post('labels')
  @HttpCode(200)
  createLabel(@Body() dto: CreateLabelDto, @CurrentUser() user: RequestUser) {
    return this.ifs.createLabel(dto.payload, {
      invoiceId: dto.invoice_id,
      actorUserId: user.id,
    });
  }

  @Post('shipment-details')
  @HttpCode(200)
  shipmentDetails(@Body() dto: ShipmentDetailsDto) {
    return this.ifs.viewShipmentDetails(dto);
  }

  @Post('void')
  @HttpCode(200)
  @Roles('admin')
  voidShipment(@Body() dto: VoidShipmentDto) {
    return this.ifs.voidShipment(dto.shipment_id);
  }
}
