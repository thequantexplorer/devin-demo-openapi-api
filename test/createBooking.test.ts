import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NOW, expectBookingShape, expectError, expectValidationError, makeApp, validBody } from './helpers';

const post = (app: ReturnType<typeof makeApp>['app'], body: unknown) => request(app).post('/bookings').send(body as object);

describe('POST /bookings (createBooking)', () => {
  describe('201', () => {
    it('creates an active booking and returns it with UTC times', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody());
      expect(res.status).toBe(201);
      expectBookingShape(res.body);
      expect(res.body).toEqual({
        id: 'bk_1',
        roomId: 'room-beta',
        guestEmail: 'ada@example.com',
        partySize: 6,
        startsAt: '2030-01-15T09:00:00.000Z',
        endsAt: '2030-01-15T10:30:00.000Z',
        status: 'active',
        createdAt: NOW,
        cancelledAt: null,
        cancelReason: null,
      });
    });

    it('assigns ids in sequence bk_1, bk_2, ...', async () => {
      const { app } = makeApp();
      const first = await post(app, validBody());
      const second = await post(app, validBody({ roomId: 'room-gamma' }));
      expect([first.body.id, second.body.id]).toEqual(['bk_1', 'bk_2']);
    });

    it('normalises times with an offset to UTC', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ startsAt: '2030-01-15T10:00:00+01:00', endsAt: '2030-01-15T05:30:00-05:00' }));
      expect(res.status).toBe(201);
      expect(res.body.startsAt).toBe('2030-01-15T09:00:00.000Z');
      expect(res.body.endsAt).toBe('2030-01-15T10:30:00.000Z');
    });

    it('accepts the edges: party size equal to capacity, 15 minutes, 4 hours, starting 15 minutes after now', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody({ roomId: 'room-alpha', partySize: 4 }))).status).toBe(201);
      expect((await post(app, validBody({ partySize: 1, startsAt: '2030-01-16T09:00:00Z', endsAt: '2030-01-16T09:15:00Z' }))).status).toBe(201);
      expect((await post(app, validBody({ partySize: 8, startsAt: '2030-01-17T09:00:00Z', endsAt: '2030-01-17T13:00:00Z' }))).status).toBe(201);
      expect((await post(app, validBody({ startsAt: '2030-01-01T08:15:00Z', endsAt: '2030-01-01T09:00:00Z' }))).status).toBe(201);
    });

    it('allows back-to-back bookings in the same room', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody({ startsAt: '2030-01-15T09:00:00Z', endsAt: '2030-01-15T10:00:00Z' }))).status).toBe(201);
      expect((await post(app, validBody({ startsAt: '2030-01-15T10:00:00Z', endsAt: '2030-01-15T11:00:00Z' }))).status).toBe(201);
      expect((await post(app, validBody({ startsAt: '2030-01-15T08:00:00Z', endsAt: '2030-01-15T09:00:00Z' }))).status).toBe(201);
    });

    it('allows the same time in a different room', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody())).status).toBe(201);
      expect((await post(app, validBody({ roomId: 'room-gamma' }))).status).toBe(201);
    });

    it('ignores cancelled bookings when checking for conflicts', async () => {
      const { app } = makeApp();
      const first = await post(app, validBody());
      expect((await request(app).post(`/bookings/${first.body.id}/cancel`)).status).toBe(200);
      const res = await post(app, validBody());
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('bk_2');
    });
  });

  describe('400', () => {
    it('invalid_json when the body is not valid JSON', async () => {
      const { app } = makeApp();
      const res = await request(app).post('/bookings').set('Content-Type', 'application/json').send('{"roomId": ');
      const error = expectError(res, 400, 'invalid_json');
      expect(error.details).toBeUndefined();
    });

    it.each([
      ['an array', [validBody()]],
      ['a number', 42],
      ['null', null],
      ['a string', 'room-beta'],
    ])('validation_error when the body is valid JSON but %s', async (_name, body) => {
      const { app } = makeApp();
      const res = await request(app).post('/bookings').set('Content-Type', 'application/json').send(JSON.stringify(body));
      expectValidationError(res, ['']);
    });

    it('validation_error for an unknown property, one entry per property', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ notes: 'hi', id: 'bk_9' }));
      expectValidationError(res, ['notes', 'id']);
    });

    it.each(['roomId', 'guestEmail', 'partySize', 'startsAt', 'endsAt'])('validation_error when %s is missing', async (field) => {
      const { app } = makeApp();
      const body: Record<string, unknown> = validBody();
      delete body[field];
      expectValidationError(await post(app, body), [field]);
    });

    it.each([
      ['roomId is not a string', { roomId: 7 }, 'roomId'],
      ['guestEmail is not an email', { guestEmail: 'ada.example.com' }, 'guestEmail'],
      ['guestEmail is longer than 254 characters', { guestEmail: `${'a'.repeat(243)}@example.com` }, 'guestEmail'],
      ['partySize is 0', { partySize: 0 }, 'partySize'],
      ['partySize is 51', { partySize: 51 }, 'partySize'],
      ['partySize is not an integer', { partySize: 2.5 }, 'partySize'],
      ['partySize is a numeric string', { partySize: '6' }, 'partySize'],
      ['startsAt is not a date-time', { startsAt: 'tomorrow' }, 'startsAt'],
      ['startsAt has no offset', { startsAt: '2030-01-15T09:00:00' }, 'startsAt'],
      ['startsAt is a date only', { startsAt: '2030-01-15' }, 'startsAt'],
      ['startsAt is not a real date', { startsAt: '2030-02-30T09:00:00Z' }, 'startsAt'],
      ['endsAt is a number', { endsAt: 1_900_000_000_000 }, 'endsAt'],
      ['startsAt is not on a 15-minute boundary', { startsAt: '2030-01-15T09:10:00Z' }, 'startsAt'],
      ['startsAt has non-zero seconds', { startsAt: '2030-01-15T09:00:30Z' }, 'startsAt'],
      ['endsAt has non-zero fractional seconds', { endsAt: '2030-01-15T10:30:00.500Z' }, 'endsAt'],
      ['endsAt equals startsAt', { endsAt: '2030-01-15T09:00:00Z' }, 'endsAt'],
      ['endsAt is before startsAt', { endsAt: '2030-01-15T08:00:00Z' }, 'endsAt'],
      ['the booking lasts longer than 4 hours', { endsAt: '2030-01-15T13:15:00Z' }, 'endsAt'],
    ])('validation_error when %s', async (_name, overrides, path) => {
      const { app } = makeApp();
      expectValidationError(await post(app, validBody(overrides)), [path]);
    });

    it('validation_error when the booking lasts less than 15 minutes (also off the boundary)', async () => {
      const { app } = makeApp();
      const error = expectValidationError(await post(app, validBody({ endsAt: '2030-01-15T09:10:00Z' })), ['endsAt', 'endsAt']);
      expect(error.details?.map((d) => d.message)).toEqual([
        'Must be on a 15-minute boundary with zero seconds',
        'Booking must last at least 15 minutes',
      ]);
    });

    it('accepts a 254-character email', async () => {
      const { app } = makeApp();
      const guestEmail = `${'a'.repeat(242)}@example.com`;
      expect(guestEmail).toHaveLength(254);
      expect((await post(app, validBody({ guestEmail }))).status).toBe(201);
    });

    it('returns one details entry per broken rule', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ partySize: 0, guestEmail: 'nope', extra: true, endsAt: '2030-01-15T08:00:00Z' }));
      const error = expectValidationError(res, ['guestEmail', 'partySize', 'extra', 'endsAt']);
      expect(error.message).toBe('Request is invalid');
    });

    it('checks 400 before 404, 422 and 409', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody())).status).toBe(201);
      const res = await post(
        app,
        validBody({ roomId: 'room-nope', partySize: 51, startsAt: '2029-01-15T09:00:00Z', endsAt: '2029-01-15T09:00:00Z' }),
      );
      expectError(res, 400, 'validation_error');
    });
  });

  describe('404', () => {
    it.each(['room-delta', 'Room-Alpha', ''])('room_not_found when roomId is %j', async (roomId) => {
      const { app } = makeApp();
      expectError(await post(app, validBody({ roomId })), 404, 'room_not_found');
    });

    it('checks 404 before 422', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ roomId: 'room-delta', partySize: 50, startsAt: '2029-01-15T09:00:00Z', endsAt: '2029-01-15T10:00:00Z' }));
      expectError(res, 404, 'room_not_found');
    });
  });

  describe('422', () => {
    it('capacity_exceeded when partySize is larger than the room capacity', async () => {
      const { app } = makeApp();
      expectError(await post(app, validBody({ roomId: 'room-alpha', partySize: 5 })), 422, 'capacity_exceeded');
      expectError(await post(app, validBody({ roomId: 'room-beta', partySize: 9 })), 422, 'capacity_exceeded');
      expectError(await post(app, validBody({ roomId: 'room-gamma', partySize: 13 })), 422, 'capacity_exceeded');
    });

    it('starts_in_past when startsAt is before now', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ startsAt: '2030-01-01T07:00:00Z', endsAt: '2030-01-01T09:00:00Z' }));
      expectError(res, 422, 'starts_in_past');
    });

    it('starts_in_past when startsAt equals now', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:00:00Z' }));
      expectError(res, 422, 'starts_in_past');
    });

    it('uses the injected clock for "now"', async () => {
      const { app, clock } = makeApp();
      clock.set('2030-01-15T09:00:00Z');
      expectError(await post(app, validBody()), 422, 'starts_in_past');
    });

    it('checks capacity_exceeded before starts_in_past', async () => {
      const { app } = makeApp();
      const res = await post(app, validBody({ partySize: 9, startsAt: '2029-01-15T09:00:00Z', endsAt: '2029-01-15T10:00:00Z' }));
      expectError(res, 422, 'capacity_exceeded');
    });

    it('checks 422 before 409', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody())).status).toBe(201);
      expectError(await post(app, validBody({ partySize: 9 })), 422, 'capacity_exceeded');
    });
  });

  describe('409', () => {
    it.each([
      ['the same time', '2030-01-15T09:00:00Z', '2030-01-15T10:30:00Z'],
      ['an overlap at the start', '2030-01-15T08:30:00Z', '2030-01-15T09:15:00Z'],
      ['an overlap at the end', '2030-01-15T10:15:00Z', '2030-01-15T11:00:00Z'],
      ['a time inside the booking', '2030-01-15T09:30:00Z', '2030-01-15T10:00:00Z'],
      ['a time around the booking', '2030-01-15T08:00:00Z', '2030-01-15T11:00:00Z'],
    ])('booking_conflict for %s in the same room', async (_name, startsAt, endsAt) => {
      const { app, store } = makeApp();
      expect((await post(app, validBody())).status).toBe(201);
      expectError(await post(app, validBody({ startsAt, endsAt, partySize: 2 })), 409, 'booking_conflict');
      expect(store.all()).toHaveLength(1);
    });

    it('booking_conflict when the overlap is only visible after normalising offsets', async () => {
      const { app } = makeApp();
      expect((await post(app, validBody())).status).toBe(201);
      const res = await post(app, validBody({ startsAt: '2030-01-15T11:00:00+01:00', endsAt: '2030-01-15T12:00:00+01:00' }));
      expectError(res, 409, 'booking_conflict');
    });
  });
});
