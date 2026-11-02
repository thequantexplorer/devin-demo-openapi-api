import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`acme-rooms-api listening on http://localhost:${port}`);
});
