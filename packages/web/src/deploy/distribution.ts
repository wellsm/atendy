import type { Environment } from '@ez4/common';
import type { Cdn } from '@ez4/distribution';
import type { WebFiles } from './storage';

/**
 * Panel SPA. No custom domain yet: served on the `*.cloudfront.net` domain (`npm run output:dev`).
 */
export declare class WebCdn extends Cdn.Service {
  defaultIndex: 'index.html';

  aliases: [];

  defaultOrigin: Cdn.UseDefaultOrigin<{
    bucket: Environment.Service<WebFiles>;
    // Every client route (`/menu/new`, `/admin/costs`, ...) serves the SPA shell; files keep their own path.
    rewrite: [
      Cdn.UseRewriteRule<{
        from: '!*.{js|css|txt|png|svg|ico|jpg|webp|woff|woff2|map|json}';
        to: '/';
      }>
    ];
  }>;

  // Routes are all rewritten to `/` and cached that way: a new deploy must drop the old shell.
  invalidations: ['/*'];
}
