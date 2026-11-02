import { Router, type Response } from 'express';
import type { AppContext } from '../app';

// Contract: openapi/bookings.yaml

function notImplemented(res: Response, operationId: string) {
  res.status(501).json({
    error: { code: 'not_implemented', message: `${operationId} is not implemented yet` },
  });
}

export function bookingsRouter(_ctx: AppContext) {
  const router = Router();

  // TODO: createBooking
  router.post('/', (_req, res) => notImplemented(res, 'createBooking'));

  // TODO: listBookings
  router.get('/', (_req, res) => notImplemented(res, 'listBookings'));

  // TODO: cancelBooking
  router.post('/:bookingId/cancel', (_req, res) => notImplemented(res, 'cancelBooking'));

  return router;
}
