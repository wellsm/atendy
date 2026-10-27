import type { Bucket } from '@ez4/storage';

/**
 * Customer voice notes, private: the panel plays them through signed read URLs (`<audio>` needs no CORS). Customer
 * audio expires after 90 days.
 */
export declare class VoiceNotes extends Bucket.Service {
  autoExpireDays: 90;
}

/**
 * Product photos, private: menus carry signed read URLs. The panel PUTs straight to the bucket with a signed URL, so
 * every web origin that serves the panel must be listed here (Ez4 CORS is a type literal, like the API's).
 */
export declare class ProductImages extends Bucket.Service {
  cors: Bucket.UseCors<{
    allowOrigins: ['http://localhost:3000', 'https://d1wc504nfok37p.cloudfront.net'];
    allowMethods: ['PUT'];
    allowHeaders: ['content-type'];
    maxAge: 300;
  }>;
}
