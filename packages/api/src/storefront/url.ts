/**
 * Public menu link of a store (`/<slug>` on the web app). Built in code only: the model copies it, never composes it.
 */
export const storefrontUrl = (webBaseUrl: string, slug: string) => `${webBaseUrl.replace(/\/+$/, '')}/${slug}`;
