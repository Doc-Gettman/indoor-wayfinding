import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { Router } from 'express';
import { IMAGES_DIR } from './db.js';
import { authRouter } from './routes/auth.js';
import { buildingsRouter } from './routes/buildings.js';
import { floorsRouter } from './routes/floors.js';
import { nodesRouter } from './routes/nodes.js';
import { edgesRouter } from './routes/edges.js';
import { poisRouter } from './routes/pois.js';
import { landmarksRouter } from './routes/landmarks.js';
import { qrcodesRouter } from './routes/qrcodes.js';
import { wayfindRouter } from './routes/wayfind.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_BASE_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  })
);

app.use('/images', express.static(IMAGES_DIR));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/auth', authRouter);
app.use('/buildings', buildingsRouter);

const buildingSubresources = Router({ mergeParams: true });
buildingSubresources.use('/floors', floorsRouter);
buildingSubresources.use('/nodes', nodesRouter);
buildingSubresources.use('/edges', edgesRouter);
buildingSubresources.use('/pois', poisRouter);
buildingSubresources.use('/landmarks', landmarksRouter);
buildingSubresources.use('/qrcodes', qrcodesRouter);
buildingSubresources.use('/wayfind', wayfindRouter);
app.use('/buildings/:buildingId', buildingSubresources);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Wayfinding API listening on http://localhost:${PORT}`);
});
