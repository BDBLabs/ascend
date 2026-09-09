import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import {
  validateElevatorUnitInput,
  type ElevatorType,
} from '@/lib/ascend/ascend-contract';
import { createElevatorUnit } from '@/lib/ascend/elevator-units';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const num = (v: unknown): number | null | undefined =>
  typeof v === 'number' ? v : v === null ? null : undefined;

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'customers.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const rawType = str(body.elevatorType) ?? '';
  const input = {
    buildingId: typeof body.buildingId === 'string' ? body.buildingId : '',
    unitNumber: typeof body.unitNumber === 'string' ? body.unitNumber : '',
    elevatorNumber: str(body.elevatorNumber),
    manufacturer: str(body.manufacturer),
    model: str(body.model),
    serialNumber: str(body.serialNumber),
    elevatorType: rawType as ElevatorType | '',
    ratedLoadLbs: num(body.ratedLoadLbs) ?? null,
    ratedSpeedFpm: num(body.ratedSpeedFpm) ?? null,
    stops: num(body.stops) ?? null,
    floorsServed: str(body.floorsServed),
    controllerManufacturer: str(body.controllerManufacturer),
    controllerModel: str(body.controllerModel),
    driveManufacturer: str(body.driveManufacturer),
    driveModel: str(body.driveModel),
    doorOperatorManufacturer: str(body.doorOperatorManufacturer),
    doorOperatorModel: str(body.doorOperatorModel),
    existingCondition: str(body.existingCondition),
    notes: str(body.notes),
  };
  const errors = validateElevatorUnitInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const unit = await withFieldContext(gate.principal, () =>
      createElevatorUnit(input),
    );
    return privateJson({ unit }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
