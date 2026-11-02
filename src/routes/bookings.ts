import { Router, type ErrorRequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app';
import { findRoom } from '../rooms';
import type { Booking } from '../store';

// Contract: openapi/bookings.yaml
// When a request breaks more than one rule: 400, then 404, then 422, then 409.

const MINUTE_MS = 60_000;
const MIN_DURATION_MS = 15 * MINUTE_MS;
const MAX_DURATION_MS = 4 * 60 * MINUTE_MS;

interface ErrorDetail {
  path: string;
  message: string;
}

function sendError(res: Response, status: number, code: string, message: string, details?: ErrorDetail[]) {
  res.status(status).json({ error: details ? { code, message, details } : { code, message } });
}

function sendValidationError(res: Response, details: ErrorDetail[]) {
  sendError(res, 400, 'validation_error', 'Request is invalid', details);
}

/** One `details` entry per broken rule. Unknown properties get one entry each. */
function toDetails(error: z.ZodError, prefix?: string): ErrorDetail[] {
  const join = (path: (string | number)[]) => [...(prefix ? [prefix] : []), ...path].join('.');
  return error.issues.flatMap((issue) =>
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? issue.keys.map((key) => ({ path: join([...issue.path, key]), message: 'Unknown property' }))
      : [{ path: join(issue.path), message: issue.message }],
  );
}

// RFC 3339 date-time with a required offset (`Z` or `±HH:MM`).
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

function parseDateTime(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const m = RFC3339.exec(value);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const dateTimeSchema = z.string({ invalid_type_error: 'Must be a string' }).superRefine((value, ctx) => {
  const date = parseDateTime(value);
  if (!date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be an RFC 3339 date-time with an offset' });
  } else if (date.getTime() % (15 * MINUTE_MS) !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be on a 15-minute boundary with zero seconds' });
  }
});

const required = { required_error: 'Required' };

const createBookingSchema = z
  .object(
    {
      roomId: z.string({ ...required, invalid_type_error: 'Must be a string' }),
      guestEmail: z
        .string({ ...required, invalid_type_error: 'Must be a string' })
        .max(254, 'Must be at most 254 characters')
        .email('Must be a valid email address'),
      partySize: z
        .number({ ...required, invalid_type_error: 'Must be an integer' })
        .int('Must be an integer')
        .min(1, 'Must be at least 1')
        .max(50, 'Must be at most 50'),
      startsAt: dateTimeSchema,
      endsAt: dateTimeSchema,
    },
    { invalid_type_error: 'Must be a JSON object' },
  )
  .strict();

/** Cross-field rules. Checked whenever both times are valid date-times, even if other fields are broken. */
function timeRangeDetails(body: unknown): ErrorDetail[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
  const { startsAt, endsAt } = body as Record<string, unknown>;
  const start = parseDateTime(startsAt);
  const end = parseDateTime(endsAt);
  if (!start || !end) return [];
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return [{ path: 'endsAt', message: 'Must be after startsAt' }];
  if (duration < MIN_DURATION_MS) return [{ path: 'endsAt', message: 'Booking must last at least 15 minutes' }];
  if (duration > MAX_DURATION_MS) return [{ path: 'endsAt', message: 'Booking must last at most 4 hours' }];
  return [];
}

const listQuerySchema = z.object({
  roomId: z
    .string({ invalid_type_error: 'Must be a single string' })
    .regex(/^room-[a-z]+$/, 'Must match ^room-[a-z]+$')
    .optional(),
  status: z
    .enum(['active', 'cancelled'], {
      errorMap: () => ({ message: 'Must be active or cancelled' }),
    })
    .optional(),
  limit: z
    .string({ invalid_type_error: 'Must be a single integer' })
    .regex(/^-?\d+$/, 'Must be an integer')
    .transform(Number)
    .pipe(z.number().min(1, 'Must be at least 1').max(100, 'Must be at most 100'))
    .optional(),
});

const bookingIdSchema = z.string().regex(/^bk_[0-9]+$/, 'Must match ^bk_[0-9]+$');

const cancelBodySchema = z
  .object(
    { reason: z.string({ invalid_type_error: 'Must be a string' }).max(200, 'Must be at most 200 characters').optional() },
    { invalid_type_error: 'Must be a JSON object' },
  )
  .strict();

const bookingNumber = (id: string) => Number(id.slice('bk_'.length));

function compareBookings(a: Booking, b: Booking) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt) || bookingNumber(a.id) - bookingNumber(b.id);
}

const overlaps = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

export function bookingsRouter(ctx: AppContext) {
  const router = Router();

  // createBooking
  router.post('/', (req, res) => {
    const parsed = createBookingSchema.safeParse(req.body);
    const details = [...(parsed.success ? [] : toDetails(parsed.error)), ...timeRangeDetails(req.body)];
    if (!parsed.success || details.length > 0) return sendValidationError(res, details);
    const body = parsed.data;

    const room = findRoom(body.roomId);
    if (!room) return sendError(res, 404, 'room_not_found', `Room ${body.roomId} does not exist`);

    if (body.partySize > room.capacity) {
      return sendError(
        res,
        422,
        'capacity_exceeded',
        `Party size ${body.partySize} exceeds the capacity of ${room.id} (${room.capacity})`,
      );
    }

    const now = ctx.clock();
    const startsAt = new Date(body.startsAt).toISOString();
    const endsAt = new Date(body.endsAt).toISOString();
    if (Date.parse(startsAt) <= now.getTime()) {
      return sendError(res, 422, 'starts_in_past', 'Booking must start after now');
    }

    const conflict = ctx.store
      .all()
      .find((b) => b.roomId === room.id && b.status === 'active' && overlaps(b, { startsAt, endsAt }));
    if (conflict) {
      return sendError(res, 409, 'booking_conflict', `${room.id} is already booked for part of this time`);
    }

    const booking = ctx.store.insert({
      roomId: room.id,
      guestEmail: body.guestEmail,
      partySize: body.partySize,
      startsAt,
      endsAt,
      status: 'active',
      createdAt: now.toISOString(),
      cancelledAt: null,
      cancelReason: null,
    });
    res.status(201).json(booking);
  });

  // listBookings
  router.get('/', (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendValidationError(res, toDetails(parsed.error, 'query'));
    const { roomId, status, limit = 50 } = parsed.data;

    const data = ctx.store
      .all()
      .filter((b) => (roomId === undefined || b.roomId === roomId) && (status === undefined || b.status === status))
      .sort(compareBookings)
      .slice(0, limit);
    res.status(200).json({ data });
  });

  // cancelBooking
  router.post('/:bookingId/cancel', (req, res) => {
    const id = bookingIdSchema.safeParse(req.params.bookingId);
    const body = cancelBodySchema.safeParse(req.body);
    const details = [
      ...(id.success ? [] : toDetails(id.error, 'path.bookingId')),
      ...(body.success ? [] : toDetails(body.error)),
    ];
    if (!id.success || !body.success) return sendValidationError(res, details);

    const booking = ctx.store.get(id.data);
    if (!booking) return sendError(res, 404, 'booking_not_found', `Booking ${id.data} does not exist`);

    const now = ctx.clock();
    if (Date.parse(booking.startsAt) <= now.getTime()) {
      return sendError(res, 422, 'booking_started', `Booking ${booking.id} has already started`);
    }
    if (booking.status === 'cancelled') {
      return sendError(res, 409, 'already_cancelled', `Booking ${booking.id} is already cancelled`);
    }

    const updated = ctx.store.update(booking.id, {
      status: 'cancelled',
      cancelledAt: now.toISOString(),
      cancelReason: body.data.reason ?? null,
    });
    res.status(200).json(updated);
  });

  return router;
}

/** Maps body-parser's parse failures to 400 `invalid_json`. Register after the routes. */
export const invalidJsonHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
  }
  next(err);
};
