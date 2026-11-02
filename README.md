# acme-rooms-api

The API behind Acme's meeting room bookings. Express + TypeScript, with an in-memory store.

The contract is [`openapi/bookings.yaml`](openapi/bookings.yaml). It defines three operations, `createBooking`, `listBookings` and `cancelBooking`, with their validation rules, conflict rules and every response code. The handlers in `src/routes/bookings.ts` are not written yet. They return `501 Not Implemented`, so `test/contract.test.ts` fails.

```sh
npm install
npm start           # http://localhost:3000
npm run typecheck
npm test
```

## Layout

| Path | What it is |
|------|------------|
| `openapi/bookings.yaml` | The API contract. The source of truth for behaviour. |
| `src/app.ts` | `createApp({ clock, store })`. Pass a fixed `clock` in tests. |
| `src/routes/bookings.ts` | The bookings handlers (still `501`). |
| `src/store.ts` | In-memory `BookingStore`. Ids are `bk_1`, `bk_2`, ... |
| `src/rooms.ts` | The fixed list of rooms and their capacities. |
| `test/` | Vitest + Supertest tests. |

## Conventions

- Validate requests with [Zod](https://zod.dev) (already a dependency).
- Every endpoint gets Supertest tests for each response code in the spec.
- Tests never use the real clock. Use `createApp({ clock: () => new Date('...') })`.

---

This repo is a starter for a Devin demo. See [DEVIN_DEMO.md](DEVIN_DEMO.md) for setup and the prompt.
