import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { config } from './config/env';
import { processEmail } from './pipeline/process-email';

const app = express();

// The workbench posts a small JSON body ({ email }); cap it to keep the demo endpoint cheap.
app.use(express.json({ limit: '64kb' }));

// Liveness endpoint.
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Phase 8 Prototype Workbench API. Runs the full pipeline for one customer email and returns the
 * frontend-ready bundle (intent, slots, evidence, decision, response and the audit record). The
 * pipeline fails safe: an LLM outage degrades to escalation, never to an HTTP error, so a 500
 * here means an unexpected server fault, not a normal "we cannot answer" outcome.
 */
app.post('/api/process', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : '';
  if (email.trim().length === 0) {
    res.status(400).json({ error: 'A non-empty "email" string is required.' });
    return;
  }
  if (email.length > 8_000) {
    res.status(413).json({ error: 'Email exceeds the 8000-character demo limit.' });
    return;
  }

  // The Workbench flags built-in demo scenarios so time-relative rules use the fixed demo clock;
  // custom emails (demoMode falsy) are evaluated against the real time. See config/demo-clock.ts.
  const demoMode = req.body?.demoMode === true;

  try {
    const result = await processEmail(email, { demoMode });
    res.status(200).json(result);
  } catch (error) {
    // Do not serialize the error: provider SDK errors can carry request metadata.
    console.error('process-email failed:', error instanceof Error ? error.message : 'unknown');
    res.status(500).json({ error: 'Pipeline execution failed unexpectedly.' });
  }
});

// Static workbench (index.html, styles.css, app.js). Resolved relative to the compiled dist dir.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`Workbench: http://localhost:${config.port}/`);
});
