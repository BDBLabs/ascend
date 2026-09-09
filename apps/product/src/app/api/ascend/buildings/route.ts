import type { NextRequest } from 'next/server';
import { privateJson } from '@/lib/http';
import { validateBuildingInput } from '@/lib/ascend/ascend-contract';
import { createBuilding } from '@/lib/ascend/buildings';
import {
  ascendServiceError,
  gateAscendWrite,
  readAscendBody,
  withFieldContext,
} from '../shared';

export const dynamic = 'force-dynamic';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

export async function POST(request: NextRequest) {
  const gate = await gateAscendWrite(request, 'customers.write');
  if ('response' in gate) return gate.response;
  const read = await readAscendBody(request);
  if ('response' in read) return read.response;
  const body = read.body;

  const input = {
    customerId: typeof body.customerId === 'string' ? body.customerId : '',
    name: typeof body.name === 'string' ? body.name : '',
    address: str(body.address),
    city: str(body.city),
    state: str(body.state),
    postalCode: str(body.postalCode),
    primaryContact: str(body.primaryContact),
    contactPhone: str(body.contactPhone),
    contactEmail: str(body.contactEmail),
    notes: str(body.notes),
  };
  const errors = validateBuildingInput(input);
  if (errors.length) return privateJson({ error: errors.join(' ') }, 400);

  try {
    const building = await withFieldContext(gate.principal, () =>
      createBuilding(input),
    );
    return privateJson({ building }, 201);
  } catch (error) {
    return ascendServiceError(error);
  }
}
