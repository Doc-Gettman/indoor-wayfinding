import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { DateRangeControls, downloadCsv, fileSlug, formatWeek, useDateRange } from '../reportUtils.jsx';

const DEFAULT_WEEKS = 12;

export default function GroupReport() {
  const { groupId } = useParams();
  const range = useDateRange(DEFAULT_WEEKS * 7);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { since, until, tz } = range.query || {};

  useEffect(() => {
    if (!since) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .groupRequestSummary(groupId, { since, until, tz })
      .then((next) => !cancelled && setSummary(next))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [groupId, since, until, tz]);

  const groupName = summary?.group?.name || 'Group';
  // Newest week first: the most recent activity is what people check most.
  const weeks = summary ? [...summary.weeks].reverse() : [];

  function exportCsv() {
    downloadCsv(`${fileSlug(groupName)}_weekly-summary_${range.start}_to_${range.end}.csv`, [
      ['Week of (Mon)', ...summary.buildings.map((b) => b.name), 'Total'],
      ...summary.weeks.map((w) => [w.weekStart, ...summary.buildings.map((b) => w.byBuilding[b.id]), w.total]),
      ['Total', ...summary.buildings.map((b) => b.total), summary.total],
    ]);
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/admin/buildings">Buildings</Link> / <Link to="/admin/groups">Groups</Link> / {groupName} summary
      </div>
      <h1>Directions summary: {groupName}</h1>
      <p className="muted">
        Completed directions requests for every building in this group, by week (Monday–Sunday) and building.
      </p>

      <div className="card row report-toolbar">
        <DateRangeControls range={range} />
        <button type="button" onClick={exportCsv} disabled={!summary?.buildings.length}>
          Download summary (CSV)
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {!summary ? (
        <p className="muted">{loading ? 'Loading...' : ''}</p>
      ) : summary.buildings.length === 0 ? (
        <p className="muted">This group has no buildings yet.</p>
      ) : (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <p className="report-total">
            <strong>{summary.total.toLocaleString()}</strong> direction request{summary.total === 1 ? '' : 's'} across{' '}
            <strong>{summary.buildings.length}</strong> building{summary.buildings.length === 1 ? '' : 's'}
          </p>
          <div className="report-table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  {summary.buildings.map((b) => (
                    <th key={b.id} className="num">
                      <Link to={`/admin/buildings/${b.id}/report`}>{b.name}</Link>
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatWeek(w.weekStart)}</td>
                    {summary.buildings.map((b) => (
                      <td key={b.id} className={`num${w.byBuilding[b.id] ? '' : ' muted'}`}>
                        {w.byBuilding[b.id].toLocaleString()}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{w.total.toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  {summary.buildings.map((b) => (
                    <th key={b.id} className="num">
                      {b.total.toLocaleString()}
                    </th>
                  ))}
                  <th className="num">{summary.total.toLocaleString()}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted">
            The first and last weeks may be partial if the date range starts or ends mid-week. Buildings are counted by
            their current group.
          </p>
        </div>
      )}
    </div>
  );
}
