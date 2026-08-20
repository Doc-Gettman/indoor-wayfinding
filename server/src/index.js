import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Router } from 'express';
import { authRouter } from './routes/auth.js';
import { buildingsRouter } from './routes/buildings.js';
import { groupsRouter } from './routes/groups.js';
import { floorsRouter } from './routes/floors.js';
import { nodesRouter } from './routes/nodes.js';
import { edgesRouter } from './routes/edges.js';
import { poisRouter } from './routes/pois.js';
import { destinationTypesRouter } from './routes/destinationTypes.js';
import { landmarksRouter } from './routes/landmarks.js';
import { qrcodesRouter } from './routes/qrcodes.js';
import { wayfindRouter } from './routes/wayfind.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_BASE_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

const api = Router();
api.get('/health', (req, res) => res.json({ ok: true }));
api.use('/auth', authRouter);
api.use('/buildings', buildingsRouter);
api.use('/groups', groupsRouter);

const buildingSubresources = Router({ mergeParams: true });
buildingSubresources.use('/floors', floorsRouter);
buildingSubresources.use('/nodes', nodesRouter);
buildingSubresources.use('/edges', edgesRouter);
buildingSubresources.use('/pois', poisRouter);
buildingSubresources.use('/destination-types', destinationTypesRouter);
buildingSubresources.use('/landmarks', landmarksRouter);
buildingSubresources.use('/qrcodes', qrcodesRouter);
buildingSubresources.use('/wayfind', wayfindRouter);
api.use('/buildings/:buildingId', buildingSubresources);

app.use('/api', api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Wayfinding API listening on http://localhost:${PORT}`);
  });
}

export { app };
