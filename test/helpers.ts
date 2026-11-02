import { expect } from 'vitest';
import type { Response } from 'supertest';
import { createApp } from '../src/app';
import { BookingStore, type NewBooking } from '../src/store';

export const NOW = '2030-01-01T08:00:00.000Z';

/** A clock that tests can move. Starts at NOW. */
export function fixedClock(start = NOW) {
  let now = new Date(start);
  const clock = () => new Date(now);
  clock.set = (iso: string) => {
    now = new Date(iso);
  };
  return clock;
}

export function makeApp(options: { store?: BookingStore; clock?: ReturnType<typeof fixedClock> } = {}) {
  const clock = options.clock ?? fixedClock();
  const store = options.store ?? new BookingStore();
  return { app: createApp({ clock, store }), clock, store };
}

export const validBody = (overrides: Record<string, unknown> = {}) => ({
  roomId: 'room-beta',
  guestEmail: 'ada@example.com',
  partySize: 6,
  startsAt: '2030-01-15T09:00:00Z',
  endsAt: '2030-01-15T10:30:00Z',
  ...overrides,
});

export const storedBooking = (overrides: Partial<NewBooking> = {}): NewBooking => ({
  roomId: 'room-alpha',
  guestEmail: 'ada@example.com',
  partySize: 2,
  startsAt: '2030-01-15T09:00:00.000Z',
  endsAt: '2030-01-15T10:00:00.000Z',
  status: 'active',
  createdAt: NOW,
  cancelledAt: null,
  cancelReason: null,
  ...overrides,
});

const BOOKING_KEYS = [
  'cancelReason',
  'cancelledAt',
  'createdAt',
  'endsAt',
  'guestEmail',
  'id',
  'partySize',
  'roomId',
  'startsAt',
  'status',
];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Checks a value against the spec's `Booking` schema (no extra properties, UTC toISOString times). */
export function expectBookingShape(booking: Record<string, unknown>) {
  expect(Object.keys(booking).sort()).toEqual(BOOKING_KEYS);
  expect(booking.id).toMatch(/^bk_[0-9]+$/);
  expect(['active', 'cancelled']).toContain(booking.status);
  for (const key of ['startsAt', 'endsAt', 'createdAt']) expect(booking[key]).toMatch(ISO_UTC);
  if (booking.cancelledAt !== null) expect(booking.cancelledAt).toMatch(ISO_UTC);
}

/** Checks the status, `error.code` and that the body matches the spec's `Error` schema exactly. */
export function expectError(res: Response, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(Object.keys(res.body)).toEqual(['error']);
  const { error } = res.body;
  expect(Object.keys(error).filter((k) => !['code', 'message', 'details'].includes(k))).toEqual([]);
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe('string');
  if (error.details !== undefined) {
    expect(Array.isArray(error.details)).toBe(true);
    for (const detail of error.details) {
      expect(Object.keys(detail).sort()).toEqual(['message', 'path']);
      expect(typeof detail.path).toBe('string');
      expect(typeof detail.message).toBe('string');
    }
  }
  return error as { code: string; message: string; details?: { path: string; message: string }[] };
}

export function expectValidationError(res: Response, paths: string[]) {
  const error = expectError(res, 400, 'validation_error');
  expect(error.details?.map((d) => d.path)).toEqual(paths);
  return error;
}
