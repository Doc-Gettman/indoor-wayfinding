import { Router } from 'express';
import QRCode from 'qrcode';
import { getCollection, saveCollection, nextId } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const qrcodesRouter = Router({ mergeParams: true });

const BASE_URL = process.env.CLIENT_BASE_URL || 'http://localhost:5173';
const QR_MODULE_SIZE = 12;
const QR_MARGIN_MODULES = 2;
const LABEL_FONT_SIZE = 28;
const LABEL_LINE_HEIGHT = 36;
const LABEL_TOP_MARGIN = 28;
const LABEL_SIDE_PADDING = 24;

function wayfindUrl(buildingId, originNodeId) {
  return `${BASE_URL}/wayfind/${buildingId}?from=${originNodeId}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function labelLines(label, maxChars = 28) {
  const words = String(label || 'Unnamed location').trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function qrLabelSvg(qr) {
  const code = QRCode.create(qr.url, { errorCorrectionLevel: 'M' });
  const moduleCount = code.modules.size;
  const qrSize = (moduleCount + QR_MARGIN_MODULES * 2) * QR_MODULE_SIZE;
  const lines = labelLines(qr.label);
  const labelHeight = LABEL_TOP_MARGIN + lines.length * LABEL_LINE_HEIGHT + 20;
  const width = qrSize + LABEL_SIDE_PADDING * 2;
  const height = qrSize + labelHeight;
  const qrOffset = LABEL_SIDE_PADDING;
  const labelStartY = qrSize + LABEL_TOP_MARGIN;

  const modules = [];
  for (let y = 0; y < moduleCount; y += 1) {
    for (let x = 0; x < moduleCount; x += 1) {
      if (!code.modules.get(x, y)) continue;
      modules.push(
        `<rect x="${qrOffset + (x + QR_MARGIN_MODULES) * QR_MODULE_SIZE}" y="${(y + QR_MARGIN_MODULES) * QR_MODULE_SIZE}" width="${QR_MODULE_SIZE}" height="${QR_MODULE_SIZE}" />`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(qr.label)} QR code">
  <rect width="100%" height="100%" fill="#fff"/>
  <g fill="#000" shape-rendering="crispEdges">
    ${modules.join('\n    ')}
  </g>
  <text x="${width / 2}" y="${labelStartY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${LABEL_FONT_SIZE}" font-weight="700" fill="#111">
    ${lines.map((line, index) => `<tspan x="${width / 2}" dy="${index === 0 ? 0 : LABEL_LINE_HEIGHT}">${escapeXml(line)}</tspan>`).join('\n    ')}
  </text>
</svg>`;
}

qrcodesRouter.get('/', async (req, res) => {
  res.json(await getCollection(req.params.buildingId, 'qrcodes'));
});

qrcodesRouter.post('/', requireAdmin, async (req, res) => {
  const { originNodeId, label } = req.body || {};
  if (!originNodeId) return res.status(400).json({ error: 'originNodeId is required' });
  const nodes = await getCollection(req.params.buildingId, 'nodes');
  const node = nodes.find((n) => n.id === originNodeId);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const qrcodes = await getCollection(req.params.buildingId, 'qrcodes');
  const qr = {
    id: nextId('qr'),
    originNodeId,
    label: label || node.label || 'Unnamed location',
    url: wayfindUrl(req.params.buildingId, originNodeId),
  };
  qrcodes.push(qr);
  await saveCollection(req.params.buildingId, 'qrcodes', qrcodes);
  res.status(201).json(qr);
});

qrcodesRouter.get('/:qrId/image', async (req, res) => {
  const qrcodes = await getCollection(req.params.buildingId, 'qrcodes');
  const qr = qrcodes.find((q) => q.id === req.params.qrId);
  if (!qr) return res.status(404).json({ error: 'QR code not found' });
  res.type('svg');
  res.send(qrLabelSvg(qr));
});

qrcodesRouter.delete('/:qrId', requireAdmin, async (req, res) => {
  const qrcodes = await getCollection(req.params.buildingId, 'qrcodes');
  const filtered = qrcodes.filter((q) => q.id !== req.params.qrId);
  await saveCollection(req.params.buildingId, 'qrcodes', filtered);
  res.json({ ok: true });
});
