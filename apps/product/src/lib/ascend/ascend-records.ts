/**
 * Ascend Phase 1 row mappers. Same token convention as jobs.ts/customers.ts:
 * prefer the exact `to_json(...)` token, fall back to the raw value.
 */
import type { ElevatorType, ProjectStatus } from './ascend-contract';
import type { WorkPackageStatus } from './work-package-contract';
import type { CostCategory, CostKind } from './project-cost-contract';
import type { PartStatus } from './project-part-contract';
import type { ApplicationStatus } from './billing-contract';

type Row = Record<string, unknown>;

export const timestampToken = (
  row: Row,
  column: 'created_at' | 'updated_at',
): string => {
  const exactToken = row[`${column}_token`];
  if (typeof exactToken === 'string') return exactToken;
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
};

export type BuildingRecord = {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  primaryContact: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function mapBuilding(r: Row): BuildingRecord {
  return {
    id: r.id as string,
    customerId: r.customer_id as string,
    customerName: (r.customer_name as string) ?? '',
    name: r.name as string,
    address: (r.address as string) ?? '',
    city: (r.city as string) ?? '',
    state: (r.state as string) ?? '',
    postalCode: (r.postal_code as string) ?? '',
    primaryContact: (r.primary_contact as string) ?? '',
    contactPhone: (r.contact_phone as string) ?? '',
    contactEmail: (r.contact_email as string) ?? '',
    notes: (r.notes as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type ElevatorUnitRecord = {
  id: string;
  buildingId: string;
  buildingName: string;
  unitNumber: string;
  elevatorNumber: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  elevatorType: ElevatorType | '';
  ratedLoadLbs: number | null;
  ratedSpeedFpm: number | null;
  stops: number | null;
  floorsServed: string;
  controllerManufacturer: string;
  controllerModel: string;
  driveManufacturer: string;
  driveModel: string;
  doorOperatorManufacturer: string;
  doorOperatorModel: string;
  existingCondition: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function mapElevatorUnit(r: Row): ElevatorUnitRecord {
  return {
    id: r.id as string,
    buildingId: r.building_id as string,
    buildingName: (r.building_name as string) ?? '',
    unitNumber: r.unit_number as string,
    elevatorNumber: (r.elevator_number as string) ?? '',
    manufacturer: (r.manufacturer as string) ?? '',
    model: (r.model as string) ?? '',
    serialNumber: (r.serial_number as string) ?? '',
    elevatorType: (r.elevator_type as ElevatorType | '') ?? '',
    ratedLoadLbs: (r.rated_load_lbs as number | null) ?? null,
    ratedSpeedFpm: (r.rated_speed_fpm as number | null) ?? null,
    stops: (r.stops as number | null) ?? null,
    floorsServed: (r.floors_served as string) ?? '',
    controllerManufacturer: (r.controller_manufacturer as string) ?? '',
    controllerModel: (r.controller_model as string) ?? '',
    driveManufacturer: (r.drive_manufacturer as string) ?? '',
    driveModel: (r.drive_model as string) ?? '',
    doorOperatorManufacturer: (r.door_operator_manufacturer as string) ?? '',
    doorOperatorModel: (r.door_operator_model as string) ?? '',
    existingCondition: (r.existing_condition as string) ?? '',
    notes: (r.notes as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type ModernizationProjectRecord = {
  id: string;
  displayId: string;
  customerId: string;
  customerName: string;
  buildingId: string | null;
  buildingName: string | null;
  status: ProjectStatus;
  /** Integer cents. Phase 1 carries the contract value only; budget/actual/
   * committed/forecast arrive in Phase 3. */
  contractValueCents: number;
  projectManager: string;
  startDate: string | null;
  targetCompletionDate: string | null;
  actualCompletionDate: string | null;
  notes: string;
  elevatorUnitIds: string[];
  createdAt: string;
  updatedAt: string;
};

const toIsoDate = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

export function mapModernizationProject(r: Row): ModernizationProjectRecord {
  const rawUnits = r.elevator_unit_ids;
  const elevatorUnitIds = Array.isArray(rawUnits)
    ? (rawUnits.filter((v) => typeof v === 'string') as string[])
    : [];
  return {
    id: r.id as string,
    displayId: r.display_id as string,
    customerId: r.customer_id as string,
    customerName: (r.customer_name as string) ?? '',
    buildingId: (r.building_id as string | null) ?? null,
    buildingName: (r.building_name as string | null) ?? null,
    status: r.status as ProjectStatus,
    contractValueCents: Number(r.contract_value_cents ?? 0),
    projectManager: (r.project_manager as string) ?? '',
    startDate: toIsoDate(r.start_date),
    targetCompletionDate: toIsoDate(r.target_completion_date),
    actualCompletionDate: toIsoDate(r.actual_completion_date),
    notes: (r.notes as string) ?? '',
    elevatorUnitIds,
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type WorkPackageRecord = {
  id: string;
  projectId: string;
  projectDisplayId: string;
  name: string;
  category: string;
  description: string;
  /** Integer cents. */
  budgetCostCents: number;
  /** Integer cents (sell value). */
  contractValueCents: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: WorkPackageStatus;
  percentComplete: number;
  responsiblePerson: string;
  notes: string;
  elevatorUnitIds: string[];
  createdAt: string;
  updatedAt: string;
};

export function mapWorkPackage(r: Row): WorkPackageRecord {
  const rawUnits = r.elevator_unit_ids;
  const elevatorUnitIds = Array.isArray(rawUnits)
    ? (rawUnits.filter((v) => typeof v === 'string') as string[])
    : [];
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    projectDisplayId: (r.project_display_id as string) ?? '',
    name: r.name as string,
    category: (r.category as string) ?? '',
    description: (r.description as string) ?? '',
    budgetCostCents: Number(r.budget_cost_cents ?? 0),
    contractValueCents: Number(r.contract_value_cents ?? 0),
    plannedStart: toIsoDate(r.planned_start),
    plannedFinish: toIsoDate(r.planned_finish),
    actualStart: toIsoDate(r.actual_start),
    actualFinish: toIsoDate(r.actual_finish),
    status: r.status as WorkPackageStatus,
    percentComplete: Number(r.percent_complete ?? 0),
    responsiblePerson: (r.responsible_person as string) ?? '',
    notes: (r.notes as string) ?? '',
    elevatorUnitIds,
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type ProjectCostEntryRecord = {
  id: string;
  projectId: string;
  projectDisplayId: string;
  elevatorUnitId: string | null;
  elevatorUnitNumber: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  costKind: CostKind;
  costCategory: CostCategory;
  /** Integer cents, authoritative. */
  amountCents: number;
  /** Integer hundredths of an hour, labor only. */
  laborHoursHundredths: number | null;
  laborRateCentsPerHour: number | null;
  costDate: string | null;
  sourceType: string;
  sourceRef: string;
  actorId: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export function mapProjectCostEntry(r: Row): ProjectCostEntryRecord {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    projectDisplayId: (r.project_display_id as string) ?? '',
    elevatorUnitId: (r.elevator_unit_id as string | null) ?? null,
    elevatorUnitNumber: (r.elevator_unit_number as string | null) ?? null,
    workPackageId: (r.work_package_id as string | null) ?? null,
    workPackageName: (r.work_package_name as string | null) ?? null,
    costKind: r.cost_kind as CostKind,
    costCategory: r.cost_category as CostCategory,
    amountCents: Number(r.amount_cents ?? 0),
    laborHoursHundredths: (r.labor_hours_hundredths as number | null) ?? null,
    laborRateCentsPerHour:
      (r.labor_rate_cents_per_hour as number | null) ?? null,
    costDate: toIsoDate(r.cost_date),
    sourceType: (r.source_type as string) ?? '',
    sourceRef: (r.source_ref as string) ?? '',
    actorId: (r.actor_id as string | null) ?? null,
    description: (r.description as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type ProjectPartRecord = {
  id: string;
  projectId: string;
  projectDisplayId: string;
  buildingId: string | null;
  elevatorUnitId: string | null;
  elevatorUnitNumber: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  inventoryItemId: string | null;
  inventoryItemCode: string | null;
  description: string;
  /** Integer hundredths, matching the inventory ledger convention. */
  quantityRequiredHundredths: number;
  quantityReceivedHundredths: number;
  quantityInstalledHundredths: number;
  status: PartStatus;
  /** Integer cents. */
  plannedCostCents: number;
  actualCostCents: number;
  supplier: string;
  sourceRef: string;
  neededDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function mapProjectPart(r: Row): ProjectPartRecord {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    projectDisplayId: (r.project_display_id as string) ?? '',
    buildingId: (r.building_id as string | null) ?? null,
    elevatorUnitId: (r.elevator_unit_id as string | null) ?? null,
    elevatorUnitNumber: (r.elevator_unit_number as string | null) ?? null,
    workPackageId: (r.work_package_id as string | null) ?? null,
    workPackageName: (r.work_package_name as string | null) ?? null,
    inventoryItemId: (r.inventory_item_id as string | null) ?? null,
    inventoryItemCode: (r.inventory_item_code as string | null) ?? null,
    description: r.description as string,
    quantityRequiredHundredths: Number(r.quantity_required_hundredths ?? 0),
    quantityReceivedHundredths: Number(r.quantity_received_hundredths ?? 0),
    quantityInstalledHundredths: Number(r.quantity_installed_hundredths ?? 0),
    status: r.status as PartStatus,
    plannedCostCents: Number(r.planned_cost_cents ?? 0),
    actualCostCents: Number(r.actual_cost_cents ?? 0),
    supplier: (r.supplier as string) ?? '',
    sourceRef: (r.source_ref as string) ?? '',
    neededDate: toIsoDate(r.needed_date),
    notes: (r.notes as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type BillingScheduleRecord = {
  id: string;
  projectId: string;
  retainagePercent: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function mapBillingSchedule(r: Row): BillingScheduleRecord {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    retainagePercent: Number(r.retainage_percent ?? 0),
    notes: (r.notes as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type BillingPeriodRecord = {
  id: string;
  projectId: string;
  periodNumber: number;
  periodStart: string | null;
  periodEnd: string | null;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
};

export function mapBillingPeriod(r: Row): BillingPeriodRecord {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    periodNumber: Number(r.period_number ?? 0),
    periodStart: toIsoDate(r.period_start),
    periodEnd: toIsoDate(r.period_end),
    status: r.status as 'open' | 'closed',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}

export type ProgressApplicationRecord = {
  id: string;
  billingPeriodId: string;
  periodNumber: number;
  projectId: string;
  projectDisplayId: string;
  invoiceId: string | null;
  status: ApplicationStatus;
  contractValueCents: number;
  earnedValueCents: number;
  previouslyBilledCents: number;
  retainagePercent: number;
  retainageCents: number;
  storedMaterialsCents: number;
  currentDueCents: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export function mapProgressApplication(r: Row): ProgressApplicationRecord {
  return {
    id: r.id as string,
    billingPeriodId: r.billing_period_id as string,
    periodNumber: Number(r.period_number ?? 0),
    projectId: r.project_id as string,
    projectDisplayId: (r.project_display_id as string) ?? '',
    invoiceId: (r.invoice_id as string | null) ?? null,
    status: r.status as ApplicationStatus,
    contractValueCents: Number(r.contract_value_cents ?? 0),
    earnedValueCents: Number(r.earned_value_cents ?? 0),
    previouslyBilledCents: Number(r.previously_billed_cents ?? 0),
    retainagePercent: Number(r.retainage_percent ?? 0),
    retainageCents: Number(r.retainage_cents ?? 0),
    storedMaterialsCents: Number(r.stored_materials_cents ?? 0),
    currentDueCents: Number(r.current_due_cents ?? 0),
    notes: (r.notes as string) ?? '',
    createdAt: timestampToken(r, 'created_at'),
    updatedAt: timestampToken(r, 'updated_at'),
  };
}
