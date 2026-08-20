import { z } from 'zod';
import { asyncHandler } from '../logger.js';
import { listEvents } from '../services/observability.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  q: z.string().max(120).optional(),
  level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  action: z.string().max(120).optional(),
  status: z.string().max(64).optional(),
});

export function mountEventRoutes(app, { requireAdmin }) {
  app.get('/api/events', requireAdmin, asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY' });
    res.json(await listEvents(parsed.data));
  }));
}
