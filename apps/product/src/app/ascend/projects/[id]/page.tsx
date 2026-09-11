import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFieldPrincipal, withFieldContext } from '@/lib/field-api-auth';
import { isDatabaseConfigured } from '@/lib/db';
import { formatCents } from '@/lib/tenant';
import { getModernizationProject } from '@/lib/ascend/modernization-projects';
import { listWorkPackages } from '@/lib/ascend/work-packages';
import { summarizeProjectCosts } from '@/lib/ascend/project-costs';
import { listProjectParts } from '@/lib/ascend/project-parts';
import { getElevatorUnit, listElevatorUnits } from '@/lib/ascend/elevator-units';
import {
  LinkUnitsControl,
  NewPackageForm,
  ProgressForm,
} from '../../_forms/packages';
import { NewCostForm, NewPartForm, PartUpdateForm } from '../../_forms/costs-parts';
import {
  ApplicationActions,
  NewApplicationForm,
  NewPeriodForm,
  ScheduleForm,
} from '../../_forms/billing';
import {
  CreateInvoiceButton,
  LinkChangeOrderForm,
} from '../../_forms/links';
import {
  listProjectChangeOrders,
  listRecentChangeOrders,
} from '@/lib/ascend/change-order-links';
import {
  getObligationDetail,
  listObligations,
} from '@/lib/ascend/obligations';
import { NewObligationForm, ObligationTree } from '../../_forms/obligations';
import {
  EditCostForm,
  EditPackageForm,
  EditPartForm,
  EditProjectForm,
} from '../../_forms/edits';
import { listCostEntries } from '@/lib/ascend/project-costs';
import {
  getBillingSchedule,
  listApplications,
  listBillingPeriods,
} from '@/lib/ascend/progress-billing';
import { getProjectProgress } from '@/lib/ascend/project-progress';
import {
  A,
  bigNumber,
  card,
  cardTitle,
  grid,
  heading,
  link,
  muted,
  page,
  pill,
  subtitle,
  table,
  td,
  th,
  money,
  sectionTitle,
} from '../../ascend-theme';

export const dynamic = 'force-dynamic';

const STATUS_COLORS: Record<string, string> = {
  not_started: A.textDim,
  in_progress: A.amber,
  complete: A.green,
  on_hold: A.blue,
  cancelled: A.red,
  specified: A.textDim,
  ordered: A.blue,
  shipped: A.blue,
  received: A.amber,
  allocated: A.amber,
  installed: A.green,
  returned: A.red,
  draft: A.textDim,
  submitted: A.blue,
  approved: A.green,
  rejected: A.red,
  invoiced: A.green,
};

type PageProps = { params: Promise<{ id: string }> };

export default async function AscendProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const principal = await getFieldPrincipal();
  if (!principal) redirect('/field/login');
  if (!isDatabaseConfigured()) {
    return (
      <div style={page}>
        <h1 style={heading}>Project</h1>
        <p style={subtitle}>Database not configured.</p>
      </div>
    );
  }

  const data = await withFieldContext(principal, async () => {
    const project = await getModernizationProject(id);
    if (!project) return null;
    const [
      progress,
      packages,
      costs,
      entries,
      parts,
      schedule,
      periods,
      applications,
      units,
      allUnits,
      changeOrders,
      recentOrders,
      obligations,
    ] = await Promise.all([
      getProjectProgress(id),
      listWorkPackages({ projectId: id, limit: 100 }),
      summarizeProjectCosts(id),
      listCostEntries({ projectId: id, limit: 20 }),
      listProjectParts({ projectId: id, limit: 100 }),
      getBillingSchedule(id),
      listBillingPeriods(id),
      listApplications(id),
      Promise.all(project.elevatorUnitIds.map((u) => getElevatorUnit(u))),
      listElevatorUnits({ limit: 100 }),
      listProjectChangeOrders(id),
      listRecentChangeOrders(100),
      listObligations(id),
    ]);
    const obligationDetails = (
      await Promise.all(obligations.map((o) => getObligationDetail(o.id)))
    ).filter((d) => d !== null);
    return { project, progress, packages, costs, entries, parts, schedule, periods, applications, units, allUnits, changeOrders, recentOrders, obligationDetails };
  });

  if (!data) notFound();
  const { project, progress, packages, costs, entries, parts, schedule, periods, applications, units, allUnits, changeOrders, recentOrders, obligationDetails } = data;

  return (
    <div style={page}>
      <p style={subtitle}>
        <Link href="/ascend/projects" style={link}>
          ← Projects
        </Link>
      </p>
      <h1 style={heading}>{project.displayId}</h1>
      <p style={subtitle}>
        {project.customerName}
        {project.buildingName ? ` · ${project.buildingName}` : ''} ·{' '}
        <span style={pill(STATUS_COLORS[project.status] ?? A.textDim)}>
          {project.status.replaceAll('_', ' ')}
        </span>
        {project.estimateDisplayId ? (
          <>
            {' '}· Bid{' '}
            <Link
              href={`/field/estimates/${project.estimateId}`}
              style={link}
            >
              {project.estimateDisplayId}
            </Link>
          </>
        ) : null}
      </p>

      <div style={grid}>
        <div style={card}>
          <p style={cardTitle}>Contract value</p>
          <p style={bigNumber}>{formatCents(project.contractValueCents)}</p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Approved changes</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.approvedChangeOrderCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Current contract</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.currentContractValueCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Billed to date</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.billedToDateCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Earned value</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.earnedValueCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Overall progress</p>
          <p style={bigNumber}>
            {progress ? `${progress.overallPercentComplete}%` : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Actual cost</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.actualCostCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Forecast final</p>
          <p style={bigNumber}>
            {progress ? formatCents(progress.forecastFinalCents) : '—'}
          </p>
        </div>
        <div style={card}>
          <p style={cardTitle}>Projected margin</p>
          <p
            style={{
              ...bigNumber,
              color:
                progress && progress.projectedMarginCents >= 0 ? A.green : A.red,
            }}
          >
            {progress ? formatCents(progress.projectedMarginCents) : '—'}
          </p>
        </div>
      </div>

      <div style={card}>
        <p style={cardTitle}>Project record</p>
        <p style={muted}>
          Manager: {project.projectManager || '—'} · Start:{' '}
          {project.startDate ?? '—'} · Target: {project.targetCompletionDate ?? '—'} ·
          Completed: {project.actualCompletionDate ?? '—'}
          {project.notes ? ` · ${project.notes}` : ''}
        </p>
        <div style={{ marginTop: '8px' }}>
          <EditProjectForm project={project} />
        </div>
      </div>

      <h2 style={sectionTitle}>Elevator units ({units.length})</h2>
      <LinkUnitsControl
        projectId={project.id}
        linkedUnitIds={project.elevatorUnitIds}
        units={allUnits}
      />
      {units.length === 0 ? (
        <p style={muted}>No units linked.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Unit</th>
                <th style={th}>Make / model</th>
                <th style={th}>Type</th>
                <th style={th}>Stops</th>
                <th style={th}>Controller</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) =>
                u ? (
                  <tr key={u.id}>
                    <td style={td}>
                      <Link href={`/ascend/elevators/${u.id}`} style={link}>
                        {u.unitNumber}
                      </Link>
                    </td>
                    <td style={td}>
                      {[u.manufacturer, u.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td style={td}>{u.elevatorType || '—'}</td>
                    <td style={{ ...td, ...money }}>{u.stops ?? '—'}</td>
                    <td style={td}>
                      {[u.controllerManufacturer, u.controllerModel]
                        .filter(Boolean)
                        .join(' ') || '—'}
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Work packages ({packages.length})</h2>
      <NewPackageForm projectId={project.id} />
      {packages.length === 0 ? (
        <p style={muted}>No work packages yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Package</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Progress</th>
                <th style={{ ...th, textAlign: 'right' }}>Budget</th>
                <th style={{ ...th, textAlign: 'right' }}>Sell</th>
                <th style={th}>Responsible</th>
                <th style={th}>Report</th>
                <th style={th}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((w) => (
                <tr key={w.id}>
                  <td style={td}>{w.name}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[w.status] ?? A.textDim)}>
                      {w.status.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>{w.percentComplete}%</td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(w.budgetCostCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(w.contractValueCents)}
                  </td>
                  <td style={td}>{w.responsiblePerson || '—'}</td>
                  <td style={td}>
                    <ProgressForm workPackage={w} />
                  </td>
                  <td style={td}>
                    <EditPackageForm pkg={w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Costs by lens × category</h2>
      <NewCostForm projectId={project.id} packages={packages} units={allUnits} />
      {costs.buckets.length === 0 ? (
        <p style={muted}>No cost entries yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Lens</th>
                <th style={th}>Category</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}>Entries</th>
              </tr>
            </thead>
            <tbody>
              {costs.buckets.map((b) => (
                <tr key={`${b.costKind}-${b.costCategory}`}>
                  <td style={td}>{b.costKind}</td>
                  <td style={td}>{b.costCategory}</td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(b.totalCents)}
                  </td>
                  <td style={{ ...td, ...money }}>{b.entryCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Recent entries ({entries.length})</h2>
      {entries.length === 0 ? (
        <p style={muted}>No entries yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Lens</th>
                <th style={th}>Category</th>
                <th style={th}>Description</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                <th style={th}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={td}>{e.costDate ?? '—'}</td>
                  <td style={td}>{e.costKind}</td>
                  <td style={td}>{e.costCategory}</td>
                  <td style={td}>{e.description || e.sourceRef || '—'}</td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(e.amountCents)}
                  </td>
                  <td style={td}>
                    <EditCostForm entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Parts ({parts.length})</h2>
      <NewPartForm projectId={project.id} packages={packages} units={allUnits} />
      {parts.length === 0 ? (
        <p style={muted}>No parts specified yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Part</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Required</th>
                <th style={{ ...th, textAlign: 'right' }}>Received</th>
                <th style={{ ...th, textAlign: 'right' }}>Installed</th>
                <th style={th}>Supplier</th>
                <th style={th}>Update</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id}>
                  <td style={td}>{p.description}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[p.status] ?? A.textDim)}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityRequiredHundredths / 100).toLocaleString()}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityReceivedHundredths / 100).toLocaleString()}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {(p.quantityInstalledHundredths / 100).toLocaleString()}
                  </td>
                  <td style={td}>{p.supplier || '—'}</td>
                  <td style={td}>
                    <PartUpdateForm part={p} />
                    <div style={{ marginTop: '6px' }}>
                      <EditPartForm part={p} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>Change orders ({changeOrders.length})</h2>
      <LinkChangeOrderForm
        projectId={project.id}
        orders={recentOrders.filter((o) => o.customerName === project.customerName)}
        linkedIds={changeOrders.map((c) => c.changeOrderId)}
      />
      {changeOrders.length === 0 ? (
        <p style={muted}>
          No change orders linked. Only approved change orders count toward
          the current contract value.
        </p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>CO</th>
                <th style={th}>Title</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {changeOrders.map((c) => (
                <tr key={c.changeOrderId}>
                  <td style={td}>{c.displayId}</td>
                  <td style={td}>{c.title}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[c.status] ?? A.textDim)}>
                      {c.status.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(c.changeAmountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={sectionTitle}>
        Contract obligations ({obligationDetails.length})
      </h2>
      <NewObligationForm projectId={project.id} />
      {obligationDetails.length === 0 ? (
        <p style={muted}>
          No obligations traced yet. Break the contract into obligations,
          milestones, and evidenced activities.
        </p>
      ) : (
        obligationDetails.map((d) => (
          <ObligationTree key={d.obligation.id} detail={d} packages={packages} />
        ))
      )}

      <h2 style={sectionTitle}>Billing</h2>
      <ScheduleForm
        projectId={project.id}
        currentPercent={schedule ? schedule.retainagePercent : null}
      />
      <NewPeriodForm
        projectId={project.id}
        nextNumber={
          periods.length > 0
            ? Math.max(...periods.map((p) => p.periodNumber)) + 1
            : 1
        }
      />
      <NewApplicationForm
        openPeriods={periods.filter((p) => p.status === 'open')}
        appliedPeriodIds={applications.map((a) => a.billingPeriodId)}
      />
      <p style={muted}>
        Retainage: {schedule ? `${schedule.retainagePercent}%` : 'no schedule'} ·{' '}
        {periods.length} period(s) · {applications.length} application(s)
      </p>
      {applications.length === 0 ? (
        <p style={muted}>No applications yet.</p>
      ) : (
        <div style={card}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>App</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Earned</th>
                <th style={{ ...th, textAlign: 'right' }}>Prev. billed</th>
                <th style={{ ...th, textAlign: 'right' }}>Retainage</th>
                <th style={{ ...th, textAlign: 'right' }}>Stored mat.</th>
                <th style={{ ...th, textAlign: 'right' }}>Due</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td style={td}>#{a.periodNumber}</td>
                  <td style={td}>
                    <span style={pill(STATUS_COLORS[a.status] ?? A.textDim)}>
                      {a.status}
                    </span>
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(a.earnedValueCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(a.previouslyBilledCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(a.retainageCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(a.storedMaterialsCents)}
                  </td>
                  <td style={{ ...td, ...money }}>
                    {formatCents(a.currentDueCents)}
                  </td>
                  <td style={td}>
                    <ApplicationActions application={a} />
                    {a.status === 'approved' &&
                    !a.invoiceId &&
                    a.currentDueCents > 0 ? (
                      <div style={{ marginTop: '6px' }}>
                        <CreateInvoiceButton applicationId={a.id} />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
