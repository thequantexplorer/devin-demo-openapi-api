import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NOW, expectBookingShape, expectError, expectValidationError, makeApp, validBody } from './helpers';

/** App with one active booking, bk_1, for 2030-01-15 09:00-10:30Z. Now is 2030-01-01T08:00Z. */
async function appWithBooking() {
  const ctx = makeApp();
  const res = await request(ctx.app).post('/bookings').send(validBody());
  expect(res.status).toBe(201);
  return { ...ctx, booking: res.body };
}

const cancel = (app: Parameters<typeof request>[0], id: string) => request(app).post(`/bookings/${id}/cancel`);

describe('POST /bookings/{bookingId}/cancel (cancelBooking)', () => {
  describe('200', () => {
    it('cancels the booking with a reason', async () => {
      const { app, clock, booking } = await appWithBooking();
      clock.set('2030-01-10T12:00:00Z');
      const res = await cancel(app, 'bk_1').send({ reason: 'Team offsite moved' });
      expect(res.status).toBe(200);
      expectBookingShape(res.body);
      expect(res.body).toEqual({
        ...booking,
        status: 'cancelled',
        cancelledAt: '2030-01-10T12:00:00.000Z',
        cancelReason: 'Team offsite moved',
      });
    });

    it('cancels with no body and sets cancelReason to null', async () => {
      const { app, booking } = await appWithBooking();
      const res = await cancel(app, 'bk_1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...booking, status: 'cancelled', cancelledAt: NOW, cancelReason: null });
    });

    it('cancels with an empty JSON object', async () => {
      const { app } = await appWithBooking();
      const res = await cancel(app, 'bk_1').send({});
      expect(res.status).toBe(200);
      expect(res.body.cancelReason).toBeNull();
    });

    it('cancels with an empty body sent as application/json', async () => {
      const { app } = await appWithBooking();
      const res = await cancel(app, 'bk_1').set('Content-Type', 'application/json').send('');
      expect(res.status).toBe(200);
      expect(res.body.cancelReason).toBeNull();
    });

    it('accepts a reason of exactly 200 characters', async () => {
      const { app } = await appWithBooking();
      const res = await cancel(app, 'bk_1').send({ reason: 'x'.repeat(200) });
      expect(res.status).toBe(200);
      expect(res.body.cancelReason).toHaveLength(200);
    });

    it('persists the cancellation', async () => {
      const { app } = await appWithBooking();
      await cancel(app, 'bk_1').send({ reason: 'no longer needed' });
      const list = await request(app).get('/bookings?status=cancelled');
      expect(list.body.data.map((b: { id: string }) => b.id)).toEqual(['bk_1']);
    });
  });

  describe('400', () => {
    it.each(['1', 'bk_', 'bk_abc', 'BK_1', 'bk_1x', 'booking_1'])('validation_error when bookingId is %j', async (id) => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, id), ['path.bookingId']);
    });

    it('validation_error when the body has unknown properties', async () => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'bk_1').send({ reason: 'ok', status: 'cancelled' }), ['status']);
    });

    it('validation_error when reason is longer than 200 characters', async () => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'bk_1').send({ reason: 'x'.repeat(201) }), ['reason']);
    });

    it.each([
      ['reason is null', { reason: null }, 'reason'],
      ['reason is a number', { reason: 42 }, 'reason'],
    ])('validation_error when %s', async (_name, body, path) => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'bk_1').send(body), [path]);
    });

    it.each([
      ['an array', '[]'],
      ['a string', '"no reason"'],
      ['null', 'null'],
    ])('validation_error when the body is valid JSON but %s', async (_name, raw) => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'bk_1').set('Content-Type', 'application/json').send(raw), ['']);
    });

    it('invalid_json when the body is not valid JSON', async () => {
      const { app, store } = await appWithBooking();
      const res = await cancel(app, 'bk_1').set('Content-Type', 'application/json').send('{"reason": "oops"');
      expectError(res, 400, 'invalid_json');
      expect(store.get('bk_1')?.status).toBe('active');
    });

    it('reports a bad bookingId and a bad body together', async () => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'nope').send({ reason: 'x'.repeat(201), extra: 1 }), [
        'path.bookingId',
        'reason',
        'extra',
      ]);
    });

    it('checks 400 before 404', async () => {
      const { app } = await appWithBooking();
      expectValidationError(await cancel(app, 'bk_999').send({ extra: 1 }), ['extra']);
    });
  });

  describe('404', () => {
    it('booking_not_found when no booking has this id', async () => {
      const { app } = await appWithBooking();
      expectError(await cancel(app, 'bk_2'), 404, 'booking_not_found');
      expectError(await cancel(app, 'bk_01'), 404, 'booking_not_found');
    });
  });

  describe('422', () => {
    it('booking_started when startsAt equals now', async () => {
      const { app, clock, store } = await appWithBooking();
      clock.set('2030-01-15T09:00:00Z');
      expectError(await cancel(app, 'bk_1'), 422, 'booking_started');
      expect(store.get('bk_1')?.status).toBe('active');
    });

    it('booking_started when the booking is under way or over', async () => {
      const { app, clock } = await appWithBooking();
      clock.set('2030-01-15T09:45:00Z');
      expectError(await cancel(app, 'bk_1'), 422, 'booking_started');
      clock.set('2030-02-01T00:00:00Z');
      expectError(await cancel(app, 'bk_1'), 422, 'booking_started');
    });

    it('checks 422 before 409 (cancelled booking that has started)', async () => {
      const { app, clock } = await appWithBooking();
      expect((await cancel(app, 'bk_1')).status).toBe(200);
      clock.set('2030-01-15T09:30:00Z');
      expectError(await cancel(app, 'bk_1'), 422, 'booking_started');
    });
  });

  describe('409', () => {
    it('already_cancelled when the booking is already cancelled', async () => {
      const { app, store } = await appWithBooking();
      expect((await cancel(app, 'bk_1').send({ reason: 'first' })).status).toBe(200);
      expectError(await cancel(app, 'bk_1').send({ reason: 'second' }), 409, 'already_cancelled');
      expect(store.get('bk_1')?.cancelReason).toBe('first');
    });
  });
});
