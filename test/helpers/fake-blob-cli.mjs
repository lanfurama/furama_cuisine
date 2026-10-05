// Runs the fake Blob server (test/helpers/fake-blob.ts) as its own process, for E2E:
// playwright.config.ts starts it before the app with
//   FAKE_BLOB_PORT=<port> FAKE_BLOB_SECRET=<this run's secret> node test/helpers/fake-blob-cli.mjs
// and gives the app the matching read-write token, vercel_blob_rw_fakestore_<secret>.
// Node runs the .ts file through type stripping (Node ≥ 22.18), like scripts/measure-assets.mjs.
import { startFakeBlob } from './fake-blob.ts';

const fake = await startFakeBlob({
  port: Number(process.env.FAKE_BLOB_PORT) || 0,
  storeId: 'fakestore',
  secret: process.env.FAKE_BLOB_SECRET || undefined,
});
console.log(`[fake-blob] ${fake.url} (store ${fake.storeId})`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => fake.close().then(() => process.exit(0)));
