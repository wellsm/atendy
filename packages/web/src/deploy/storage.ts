import type { Bucket } from '@ez4/storage';

/**
 * Built panel (`npm run build:dev`): `index.html` plus hashed assets. `ez4 deploy` uploads the folder.
 */
export declare class WebFiles extends Bucket.Service {
  localPath: './dist/client';
}

/**
 * Demo menu photos (`demo-menu/<type>/<file>.webp`), dev only: `npm run demo-images:dev` syncs `./demo-menu` into it,
 * `ez4 deploy` never uploads them. Served by `WebCdn` on `/demo-menu/*`.
 */
export declare class DemoMenuFiles extends Bucket.Service {}
