import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { DateRangeControls, downloadCsv, fileSlug, formatDateTime, useDateRange } from '../reportUtils.jsx';

const LOG_DISPLAY_LIMIT = 500;

export default function BuildingReport() {
  const { buildingId } = useParams();
  const range = useDateRange(30);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { since, until, tz } = range.query || {};

  useEffect(() => {
    if (!since) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .buildingRequestReport(buildingId, { since, until, tz })
      .then((next) => !cancelled && setReport(next))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [buildingId, since, until, tz]);

  const buildingName = report?.building?.name || 'Building';
  const filePrefix = `${fileSlug(buildingName)}_${range.start}_to_${range.end}`;

  function exportByQrCode() {
    downloadCsv(`${filePrefix}_by-qr-code.csv`, [
      ['QR code', 'Destination', 'Requests'],
      ...report.origins.flatMap((origin) => origin.destinations.map((d) => [origin.label, d.name, d.count])),
    ]);
  }

  function exportLog() {
    downloadCsv(`${filePrefix}_all-requests.csv`, [
      ['Date/time', 'QR code', 'Destination', 'Avoid stairs'],
      ...report.requests.map((r) => [formatDateTime(r.createdAt), r.originLabel, r.destinationName, r.avoidStairs ? 'Yes' : 'No']),
    ]);
  }

  return (
    <div className="page">
      <div className="breadcrumbs">
        <Link to="/admin/buildings">Buildings</Link> / <Link to={`/admin/buildings/${buildingId}`}>{buildingName}</Link> /
        Directions report
      </div>
      <h1>Directions report: {buildingName}</h1>
      <p className="muted">Every completed directions request, by the QR code that was scanned and where the visitor asked to go.</p>

      <div className="card row report-toolbar">
        <DateRangeControls range={range} />
        <div className="row">
          <button type="button" onClick={exportByQrCode} disabled={!report?.total}>
            Download by QR code (CSV)
          </button>
          <button type="button" onClick={exportLog} disabled={!report?.total}>
            Download all requests (CSV)
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {!report ? (
        <p className="muted">{loading ? 'Loading...' : ''}</p>
      ) : (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          <p className="report-total">
            <strong>{report.total.toLocaleString()}</strong> direction request{report.total === 1 ? '' : 's'} from{' '}
            <strong>{report.origins.length}</strong> QR code{report.origins.length === 1 ? '' : 's'}
          </p>

          {report.total === 0 ? (
            <p className="muted">No directions were requested in this date range.</p>
          ) : (
            <>
              <h2>By QR code</h2>
              {report.origins.map((origin) => (
                <section key={origin.key} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>{origin.label}</h3>
                    <span className="muted">
                      {origin.total.toLocaleString()} request{origin.total === 1 ? '' : 's'}
                    </span>
                  </div>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Destination requested</th>
                        <th className="num">Requests</th>
                        <th className="num">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {origin.destinations.map((d) => (
                        <tr key={d.poiId}>
                          <td>{d.name}</td>
                          <td className="num">{d.count.toLocaleString()}</td>
                          <td className="num">{Math.round((d.count / origin.total) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}

              <h2>All requests</h2>
              {report.requests.length > LOG_DISPLAY_LIMIT && (
                <p className="muted">
                  Showing the most recent {LOG_DISPLAY_LIMIT.toLocaleString()} of {report.requests.length.toLocaleString()}. Download the
                  CSV for the full list.
                </p>
              )}
              <div className="report-table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Date/time</th>
                      <th>QR code scanned</th>
                      <th>Destination requested</th>
                      <th>Avoid stairs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.requests.slice(0, LOG_DISPLAY_LIMIT).map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.createdAt)}</td>
                        <td>{r.originLabel}</td>
                        <td>{r.destinationName}</td>
                        <td>{r.avoidStairs ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
