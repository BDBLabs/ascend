import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: () => ({ query: queryMock }),
}));

vi.mock('./modernization-projects', () => ({
  getModernizationProject: vi.fn(),
}));

vi.mock('./work-packages', () => ({
  listWorkPackages: vi.fn(),
}));

vi.mock('./project-costs', () => ({
  summarizeProjectCosts: vi.fn(),
  summarizeCostsByWorkPackage: vi.fn(),
  getProjectBilledCents: vi.fn(),
}));

vi.mock('./change-order-links', () => ({
  getProjectApprovedChangeValue: vi.fn(),
}));

import {
  computeProjectProgress,
  earnedValueCents,
  getProjectProgress,
} from './project-progress';
import { getModernizationProject } from './modernization-projects';
import { listWorkPackages } from './work-packages';
import {
  getProjectBilledCents,
  summarizeCostsByWorkPackage,
  summarizeProjectCosts,
} from './project-costs';
import { getProjectApprovedChangeValue } from './change-order-links';

const getProjectMock = vi.mocked(getModernizationProject);
const listPackagesMock = vi.mocked(listWorkPackages);
const summarizeMock = vi.mocked(summarizeProjectCosts);
const packageCostsMock = vi.mocked(summarizeCostsByWorkPackage);
const billedMock = vi.mocked(getProjectBilledCents);
const changeValueMock = vi.mocked(getProjectApprovedChangeValue);

const zeroCosts = { budget: 0, actual: 0, committed: 0, forecast: 0 };

describe('earnedValueCents', () => {
  it('computes half-up integer earned value', () => {
    expect(earnedValueCents(6800000, 40)).toBe(2720000);
    expect(earnedValueCents(100, 33)).toBe(33);
    // 10c × 15% = 1.5c → 2c
    expect(earnedValueCents(10, 15)).toBe(2);
    expect(earnedValueCents(0, 100)).toBe(0);
  });
});

describe('computeProjectProgress', () => {
  it('rolls up earned value, overall percent, forecast, and margin', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      packages: [
        {
          id: 'p1',
          name: 'Controller',
          status: 'in_progress',
          percentComplete: 40,
          contractValueCents: 6800000,
        },
        {
          id: 'p2',
          name: 'Engineering',
          status: 'complete',
          percentComplete: 100,
          contractValueCents: 3200000,
        },
      ],
      costTotals: {
        budget: 8000000,
        actual: 3000000,
        committed: 1500000,
        forecast: 0,
      },
      packageCosts: [],
    });

    // earned: 2,720,000 + 3,200,000 = 5,920,000 of 10,000,000 → 59.2% → 59
    expect(report.earnedValueCents).toBe(5920000);
    expect(report.overallPercentComplete).toBe(59);
    // no explicit forecast: actual + committed = 4,500,000
    expect(report.forecastFinalCents).toBe(4500000);
    expect(report.projectedMarginCents).toBe(5500000);
    // 55% → 5500 bps
    expect(report.projectedMarginBps).toBe(5500);
    expect(report.billedToDateCents).toBe(0);
    expect(report.remainingBillableCents).toBe(10000000);
  });

  it('prefers explicit forecast totals over actual + committed', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      packages: [],
      costTotals: { budget: 8000000, actual: 3000000, committed: 1500000, forecast: 9000000 },
      packageCosts: [],
    });
    expect(report.forecastFinalCents).toBe(9000000);
    expect(report.projectedMarginCents).toBe(1000000);
    // empty packages: 0% with no division failure
    expect(report.overallPercentComplete).toBe(0);
    expect(report.earnedValueCents).toBe(0);
  });

  it('excludes cancelled packages from earned and contract scope', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      packages: [
        {
          id: 'p1',
          name: 'Live',
          status: 'in_progress',
          percentComplete: 50,
          contractValueCents: 4000000,
        },
        {
          id: 'p2',
          name: 'Dropped',
          status: 'cancelled',
          percentComplete: 30,
          contractValueCents: 6000000,
        },
      ],
      costTotals: { ...zeroCosts, actual: 1000000 },
      packageCosts: [],
    });
    // earned: 50% of 4,000,000 only; overall over live scope only
    expect(report.earnedValueCents).toBe(2000000);
    expect(report.overallPercentComplete).toBe(50);
    expect(report.packages).toHaveLength(1);
    // spent money still counts
    expect(report.actualCostCents).toBe(1000000);
  });

  it('folds approved changes into contract, margin, and remaining', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 10000000,
      approvedChangeOrderCents: 1500000,
      billedToDateCents: 2000000,
      packages: [
        {
          id: 'p1',
          name: 'Controller',
          status: 'in_progress',
          percentComplete: 40,
          contractValueCents: 6800000,
        },
      ],
      costTotals: { budget: 0, actual: 1000000, committed: 0, forecast: 0 },
      packageCosts: [],
    });
    expect(report.currentContractValueCents).toBe(11500000);
    // margin over the current contract, not the base
    expect(report.projectedMarginCents).toBe(11500000 - 1000000);
    expect(report.billedToDateCents).toBe(2000000);
    expect(report.remainingBillableCents).toBe(11500000 - 2000000);
  });

  it('reports null margin bps on a zero contract', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 0,
      packages: [],
      costTotals: { ...zeroCosts },
      packageCosts: [],
    });
    expect(report.projectedMarginBps).toBeNull();
  });

  it('attaches per-package cost slices', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 6800000,
      packages: [
        {
          id: 'p1',
          name: 'Controller',
          status: 'in_progress',
          percentComplete: 40,
          contractValueCents: 6800000,
        },
      ],
      costTotals: { ...zeroCosts, actual: 3000000 },
      packageCosts: [
        {
          workPackageId: 'p1',
          totals: { budget: 4500000, actual: 3000000, committed: 0, forecast: 0 },
        },
      ],
    });
    expect(report.packages[0]).toMatchObject({
      earnedValueCents: 2720000,
      budgetCostCents: 4500000,
      actualCostCents: 3000000,
    });
  });
});

describe('getProjectProgress', () => {
  beforeEach(() => {
    getProjectMock.mockReset();
    listPackagesMock.mockReset();
    summarizeMock.mockReset();
    packageCostsMock.mockReset();
    billedMock.mockReset();
    changeValueMock.mockReset();
    queryMock.mockReset();
  });

  it('returns null when the project is missing', async () => {
    getProjectMock.mockResolvedValueOnce(null);
    await expect(getProjectProgress('missing')).resolves.toBeNull();
  });

  it('orchestrates project, packages, and cost rollups', async () => {
    getProjectMock.mockResolvedValueOnce({
      id: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 6800000,
    } as never);
    listPackagesMock.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Controller',
        status: 'in_progress',
        percentComplete: 40,
        contractValueCents: 6800000,
      },
    ] as never);
    summarizeMock.mockResolvedValueOnce({
      projectId: 'project-1',
      buckets: [],
      totalsByKind: { budget: 4500000, actual: 3000000, committed: 0, forecast: 0 },
    } as never);
    packageCostsMock.mockResolvedValueOnce([] as never);
    changeValueMock.mockResolvedValueOnce(500000);
    billedMock.mockResolvedValueOnce(1000000);

    const report = await getProjectProgress('project-1');
    expect(report).toMatchObject({
      projectId: 'project-1',
      earnedValueCents: 2720000,
      actualCostCents: 3000000,
      approvedChangeOrderCents: 500000,
      currentContractValueCents: 7300000,
      billedToDateCents: 1000000,
      remainingBillableCents: 6300000,
    });
  });

  it('floors a deeply credited contract at zero', () => {
    const report = computeProjectProgress({
      projectId: 'project-1',
      displayId: 'ASC-0001',
      contractValueCents: 100000,
      approvedChangeOrderCents: -500000,
      packages: [],
      costTotals: { budget: 0, actual: 0, committed: 0, forecast: 0 },
      packageCosts: [],
    });
    expect(report.currentContractValueCents).toBe(0);
    expect(report.projectedMarginBps).toBeNull();
  });
});
