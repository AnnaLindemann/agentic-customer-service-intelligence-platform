import express, { type Request, type Response } from 'express';
import { config } from './config/env';

const app = express();

// Liveness endpoint. Phase 1 exposes this only; no pipeline routes yet.
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
});
