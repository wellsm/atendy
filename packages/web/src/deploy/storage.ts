import type { Bucket } from '@ez4/storage';

/**
 * Built panel (`npm run build:dev`): `index.html` plus hashed assets. `ez4 deploy` uploads the folder.
 */
export declare class WebFiles extends Bucket.Service {
  localPath: './dist/client';
}
