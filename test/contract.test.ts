import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createApp } from '../src/app';

// Smoke check: every operation in the spec answers with a status code the spec documents for it.
// It does not replace real tests for each rule and response code.

type Operation = { operationId: string; responses: Record<string, unknown>; requestBody?: unknown };
type Spec = { paths: Record<string, Record<string, Operation>> };

const spec = parse(readFileSync(new URL('../openapi/bookings.yaml', import.meta.url), 'utf8')) as Spec;
const clock = () => new Date('2030-01-01T08:00:00Z');

const sampleBodies: Record<string, object> = {
  createBooking: {
    roomId: 'room-beta',
    guestEmail: 'ada@example.com',
    partySize: 6,
    startsAt: '2030-01-15T09:00:00Z',
    endsAt: '2030-01-15T10:30:00Z',
  },
  cancelBooking: {},
};

const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, op]) => ({ path, method, op })),
);

describe('every operation in openapi/bookings.yaml', () => {
  it.each(operations)('$method $path ($op.operationId) returns a documented status', async ({ path, method, op }) => {
    const url = path.replace('{bookingId}', 'bk_1');
    const agent = request(createApp({ clock })) as unknown as Record<string, (url: string) => request.Test>;
    let req = agent[method](url);
    const body = sampleBodies[op.operationId];
    if (body) req = req.send(body);
    const res = await req;
    expect(Object.keys(op.responses), `${op.operationId} returned ${res.status}: ${JSON.stringify(res.body)}`).toContain(
      String(res.status),
    );
  });
});
