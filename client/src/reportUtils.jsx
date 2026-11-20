import { useState } from 'react';

function toInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseInputDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Inclusive local-calendar date range ("start", "end" as YYYY-MM-DD inputs),
// converted to the [since, until) ISO instants the report API expects.
export function useDateRange(defaultDays) {
  const today = new Date();
  const [start, setStart] = useState(() => toInputDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - defaultDays + 1)));
  const [end, setEnd] = useState(() => toInputDate(today));
  const valid = Boolean(start && end && start <= end);
  const endDate = end ? parseInputDate(end) : null;
  const query = valid
    ? {
        since: parseInputDate(start).toISOString(),
        until: new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).toISOString(),
        tz: viewerTimeZone,
      }
    : null;
  return { start, end, setStart, setEnd, valid, query };
}

export function DateRangeControls({ range }) {
  return (
    <div className="row report-range">
      <label className="row" style={{ gap: 4 }}>
        <span className="muted">From</span>
        <input type="date" value={range.start} max={range.end || undefined} onChange={(e) => range.setStart(e.target.value)} />
      </label>
      <label className="row" style={{ gap: 4 }}>
        <span className="muted">To</span>
        <input type="date" value={range.end} min={range.start || undefined} onChange={(e) => range.setEnd(e.target.value)} />
      </label>
      {!range.valid && <span className="error" style={{ marginTop: 0 }}>Choose a start date on or before the end date.</span>}
    </div>
  );
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// weekStart is a calendar date (YYYY-MM-DD), not an instant — format it
// without a time-zone shift.
export function formatWeek(weekStart) {
  return parseInputDate(weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function fileSlug(text) {
  return String(text || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
