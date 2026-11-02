import express from 'express';
import { BookingStore } from './store';
import { bookingsRouter } from './routes/bookings';

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
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/bookings', bookingsRouter(ctx));

  return app;
}
