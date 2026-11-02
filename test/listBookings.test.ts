import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BookingStore } from '../src/store';
import { expectBookingShape, expectValidationError, makeApp, storedBooking } from './helpers';

function seededStore() {
  const store = new BookingStore();
  store.insert(storedBooking({ roomId: 'room-alpha', startsAt: '2030-01-15T11:00:00.000Z', endsAt: '2030-01-15T12:00:00.000Z' })); // bk_1
  store.insert(storedBooking({ roomId: 'room-beta', startsAt: '2030-01-15T09:00:00.000Z', endsAt: '2030-01-15T10:00:00.000Z' })); // bk_2
  store.insert(
    storedBooking({
      roomId: 'room-alpha',
      startsAt: '2030-01-15T09:00:00.000Z',
      endsAt: '2030-01-15T10:00:00.000Z',
      status: 'cancelled',
      cancelledAt: '2030-01-01T08:00:00.000Z',
    }),
  ); // bk_3
  store.insert(storedBooking({ roomId: 'room-gamma', startsAt: '2030-01-14T09:00:00.000Z', endsAt: '2030-01-14T10:00:00.000Z' })); // bk_4
  return store;
}

const ids = (res: request.Response) => res.body.data.map((b: { id: string }) => b.id);

describe('GET /bookings (listBookings)', () => {
  describe('200', () => {
    it('returns an empty list when there are no bookings', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/bookings');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });

    it('returns bookings sorted by startsAt, then id', async () => {
      const { app } = makeApp({ store: seededStore() });
      const res = await request(app).get('/bookings');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['data']);
      expect(ids(res)).toEqual(['bk_4', 'bk_2', 'bk_3', 'bk_1']);
      res.body.data.forEach(expectBookingShape);
    });

    it('sorts ids numerically (bk_2 before bk_10)', async () => {
      const store = new BookingStore();
      for (let i = 0; i < 10; i++) store.insert(storedBooking({ status: 'cancelled', cancelledAt: '2030-01-01T08:00:00.000Z' }));
      const { app } = makeApp({ store });
      const res = await request(app).get('/bookings');
      expect(ids(res)).toEqual(['bk_1', 'bk_2', 'bk_3', 'bk_4', 'bk_5', 'bk_6', 'bk_7', 'bk_8', 'bk_9', 'bk_10']);
    });

    it('filters by roomId', async () => {
      const { app } = makeApp({ store: seededStore() });
      expect(ids(await request(app).get('/bookings?roomId=room-alpha'))).toEqual(['bk_3', 'bk_1']);
    });

    it('returns an empty list for a well-formed roomId that does not exist', async () => {
      const { app } = makeApp({ store: seededStore() });
      const res = await request(app).get('/bookings?roomId=room-delta');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });

    it('filters by status', async () => {
      const { app } = makeApp({ store: seededStore() });
      expect(ids(await request(app).get('/bookings?status=active'))).toEqual(['bk_4', 'bk_2', 'bk_1']);
      expect(ids(await request(app).get('/bookings?status=cancelled'))).toEqual(['bk_3']);
    });

    it('combines roomId, status and limit', async () => {
      const { app } = makeApp({ store: seededStore() });
      expect(ids(await request(app).get('/bookings?roomId=room-alpha&status=active'))).toEqual(['bk_1']);
      expect(ids(await request(app).get('/bookings?status=active&limit=2'))).toEqual(['bk_4', 'bk_2']);
    });

    it('applies limit after sorting, from 1 up to 100, and defaults to 50', async () => {
      const store = new BookingStore();
      for (let i = 0; i < 120; i++) store.insert(storedBooking({ status: 'cancelled', cancelledAt: '2030-01-01T08:00:00.000Z' }));
      const { app } = makeApp({ store });
      expect((await request(app).get('/bookings')).body.data).toHaveLength(50);
      expect(ids(await request(app).get('/bookings?limit=1'))).toEqual(['bk_1']);
      expect((await request(app).get('/bookings?limit=100')).body.data).toHaveLength(100);
    });

    it('ignores unknown query parameters', async () => {
      const { app } = makeApp({ store: seededStore() });
      const res = await request(app).get('/bookings?page=2&sort=desc');
      expect(res.status).toBe(200);
      expect(ids(res)).toEqual(['bk_4', 'bk_2', 'bk_3', 'bk_1']);
    });
  });

  describe('400', () => {
    it.each([
      ['roomId does not match ^room-[a-z]+$', 'roomId=Room-Alpha', 'query.roomId'],
      ['roomId has digits', 'roomId=room-1', 'query.roomId'],
      ['roomId is empty', 'roomId=', 'query.roomId'],
      ['roomId is repeated', 'roomId=room-alpha&roomId=room-beta', 'query.roomId'],
      ['status is not active or cancelled', 'status=pending', 'query.status'],
      ['status is empty', 'status=', 'query.status'],
      ['limit is 0', 'limit=0', 'query.limit'],
      ['limit is 101', 'limit=101', 'query.limit'],
      ['limit is negative', 'limit=-1', 'query.limit'],
      ['limit is not an integer', 'limit=2.5', 'query.limit'],
      ['limit is not a number', 'limit=ten', 'query.limit'],
      ['limit is empty', 'limit=', 'query.limit'],
    ])('validation_error when %s', async (_name, query, path) => {
      const { app } = makeApp();
      expectValidationError(await request(app).get(`/bookings?${query}`), [path]);
    });

    it('returns one details entry per broken query rule', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/bookings?roomId=nope&status=open&limit=500&page=2');
      expectValidationError(res, ['query.roomId', 'query.status', 'query.limit']);
    });
  });
});
