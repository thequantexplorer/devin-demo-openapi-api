import express from 'express';
import { BookingStore } from './store';
import { bookingsRouter, invalidJsonHandler } from './routes/bookings';

export type Clock = () => Date;

export interface AppOptions {
  /** Source of "now". Tests pass a fixed clock. */
  clock?: Clock;
  store?: BookingStore;
}

export interface AppContext {
  clock: Clock;
  store: BookingStore;
}

export function createApp(options: AppOptions = {}) {
  const ctx: AppContext = {
    clock: options.clock ?? (() => new Date()),
    store: options.store ?? new BookingStore(),
  };

  const app = express();
  // strict: false so valid JSON that is not an object (e.g. `[]`, `42`) reaches Zod and gets `validation_error`.
  app.use(express.json({ strict: false }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/bookings', bookingsRouter(ctx));
  app.use(invalidJsonHandler);

  return app;
}
