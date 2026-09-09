/**
 * Ascend Phase 5 — project progress read model.
 *
 * Progress is computed, never stored: work-package percent_complete rows
 * (Phase 2) and cost-entry sums (Phase 3) are the inputs, and every figure
 * below derives from them in integer arithmetic. No floating point.
 *
 * Deliberately out of scope (later phases):
 * - approved change-order effects on contract value: J-Box change_orders
 *   link to estimate/job, not to modernization projects. Until a
 *   project↔change-order association exists (Phase 6), current contract
 *   value is the project's recorded contract_value_cents.
 * - billed to date: the invoice engine has no project linkage yet
 *   (Phase 6 progress billing). Reported as 0 with the shape reserved.
 */

import type { WorkPackageStatus } from './work-package-contract';
import { getModernizationProject } from './modernization-projects';
import { listWorkPackages } from './work-packages';
import {
  summarizeCostsByWorkPackage,
  summarizeProjectCosts,
} from './project-costs';

export type ProgressPackageInput = {
  id: string;
  name: string;
  status: WorkPackageStatus;
  percentComplete: number;
  contractValueCents: number;
};

export type ProgressCostInput = {
  budget: number;
  actual: number;
  committed: number;
  forecast: number;
};

export type ProgressPackageCostInput = {
  workPackageId: string;
  totals: ProgressCostInput;
};

export type ComputeProgressInput = {
  projectId: string;
  displayId: string;
  contractValueCents: number;
  packages: ProgressPackageInput[];
  costTotals: ProgressCostInput;
  packageCosts: ProgressPackageCostInput[];
};

export type ProgressPackageReport = {
  workPackageId: string;
  name: string;
  status: WorkPackageStatus;
  percentComplete: number;
  contractValueCents: number;
  earnedValueCents: number;
  budgetCostCents: number;
  actualCostCents: number;
  committedCostCents: number;
  forecastCostCents: number;
};

export type ProjectProgressReport = {
  projectId: string;
  displayId: string;
  /** Recorded contract value; approved change orders attach in Phase 6. */
  contractValueCents: number;
  packageCount: number;
  /** Earned-value percent, half-up integer 0-100. */
  overallPercentComplete: number;
  earnedValueCents: number;
  budgetCostCents: number;
  actualCostCents: number;
  committedCostCents: number;
  /** Explicit forecast total when recorded, else actual + committed. */
  forecastFinalCents: number;
  /** Contract minus forecast final. */
  projectedMarginCents: number;
  /** Half-up basis points, null when contract value is zero. */
  projectedMarginBps: number | null;
  /** Pre-billing placeholder (Phase 6). */
  billedToDateCents: number;
  remainingBillableCents: number;
  packages: ProgressPackageReport[];
};

/** Half-up (value * percent / 100) in integer arithmetic. */
export function earnedValueCents(
  contractValueCents: number,
  percentComplete: number,
): number {
  return Math.floor((contractValueCents * percentComplete + 50) / 100);
}

/** Half-up integer percent of part over whole; 0 when whole is 0. */
function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((2 * part * 100 + whole) / (2 * whole));
}

/** Half-up basis points, null when the base is 0. */
function marginBps(marginCents: number, contractCents: number): number | null {
  if (contractCents <= 0) return null;
  return Math.floor((2 * marginCents * 10000 + contractCents) / (2 * contractCents));
}

/**
 * Cancelled packages are reduced scope: excluded from earned value and
 * from the contract total. Their posted costs still count — money spent
 * is spent regardless of the cancellation.
 */
export function computeProjectProgress(
  input: ComputeProgressInput,
): ProjectProgressReport {
  const live = input.packages.filter((p) => p.status !== 'cancelled');
  const costByPackage = new Map(
    input.packageCosts.map((c) => [c.workPackageId, c.totals]),
  );
  const zeroCosts: ProgressCostInput = {
    budget: 0,
    actual: 0,
    committed: 0,
    forecast: 0,
  };

  let earnedTotal = 0;
  let contractTotal = 0;
  const packages: ProgressPackageReport[] = live.map((p) => {
    const earned = earnedValueCents(p.contractValueCents, p.percentComplete);
    earnedTotal += earned;
    contractTotal += p.contractValueCents;
    const costs = costByPackage.get(p.id) ?? zeroCosts;
    return {
      workPackageId: p.id,
      name: p.name,
      status: p.status,
      percentComplete: p.percentComplete,
      contractValueCents: p.contractValueCents,
      earnedValueCents: earned,
      budgetCostCents: costs.budget,
      actualCostCents: costs.actual,
      committedCostCents: costs.committed,
      forecastCostCents: costs.forecast,
    };
  });

  const forecastFinal =
    input.costTotals.forecast > 0
      ? input.costTotals.forecast
      : input.costTotals.actual + input.costTotals.committed;
  const margin = input.contractValueCents - forecastFinal;

  return {
    projectId: input.projectId,
    displayId: input.displayId,
    contractValueCents: input.contractValueCents,
    packageCount: input.packages.length,
    overallPercentComplete: percentOf(earnedTotal, contractTotal),
    earnedValueCents: earnedTotal,
    budgetCostCents: input.costTotals.budget,
    actualCostCents: input.costTotals.actual,
    committedCostCents: input.costTotals.committed,
    forecastFinalCents: forecastFinal,
    projectedMarginCents: margin,
    projectedMarginBps: marginBps(margin, input.contractValueCents),
    billedToDateCents: 0,
    remainingBillableCents: input.contractValueCents,
    packages,
  };
}

export async function getProjectProgress(
  projectId: string,
): Promise<ProjectProgressReport | null> {
  const project = await getModernizationProject(projectId);
  if (!project) return null;
  const [packages, costSummary, packageCosts] = await Promise.all([
    listWorkPackages({ projectId, limit: 100 }),
    summarizeProjectCosts(projectId),
    summarizeCostsByWorkPackage(projectId),
  ]);
  return computeProjectProgress({
    projectId: project.id,
    displayId: project.displayId,
    contractValueCents: project.contractValueCents,
    packages: packages.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      percentComplete: p.percentComplete,
      contractValueCents: p.contractValueCents,
    })),
    costTotals: {
      budget: costSummary.totalsByKind.budget,
      actual: costSummary.totalsByKind.actual,
      committed: costSummary.totalsByKind.committed,
      forecast: costSummary.totalsByKind.forecast,
    },
    packageCosts: packageCosts.map((c) => ({
      workPackageId: c.workPackageId,
      totals: c.totals,
    })),
  });
}
