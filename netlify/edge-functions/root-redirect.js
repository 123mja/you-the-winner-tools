/**
 * Root redirect edge function.
 * Runs before any _redirects rules — intercepts "/" only.
 *
 * engine.you-the-winner.com/     → index.html      (the engine's own marketing/product site)
 * mel.you-the-winner.com/        → mel-index.html  (Mel's actual personal landing page — fixed
 *                                                2026-08-09; this used to point at index.html
 *                                                as a temporary stopgap during the 2026-07-20
 *                                                domain restructuring, which was never reverted
 *                                                once Mel's instance needed to serve real content
 *                                                again. If a Cloudflare-level rewrite rule for
 *                                                this same root-path mapping still exists, it's
 *                                                now redundant with this fix, not a conflict —
 *                                                both rewrite to the same file.)
 * demo.you-the-winner.com/       → my-daily-tools.html (drops straight into the Daily Tools app;
 *                                                that page auto-starts demo mode itself when it
 *                                                detects this hostname — see my-daily-tools.html)
 * tools.you-the-winner.com/      → daily-tools-landing.html  (generic daily-tools app only —
 *                                                not personalized/customized subdomain content)
 * daily-tools.you-the-winner.com/ → daily-tools-landing.html (same as tools, alias)
 * mel-the-winner.netlify.app/    → daily-tools-landing.html (preview subdomain — same as tools)
 */
const ENGINE_HOSTS = [
  'engine.you-the-winner.com',
];

const MEL_HOSTS = [
  'mel.you-the-winner.com',
];

const DEMO_HOSTS = [
  'demo.you-the-winner.com',
];

export default async (request, context) => {
  const host = request.headers.get('host') || '';

  if (ENGINE_HOSTS.some(h => host.includes(h))) {
    return context.rewrite('/index.html');
  }

  if (MEL_HOSTS.some(h => host.includes(h))) {
    return context.rewrite('/mel-index.html');
  }

  if (DEMO_HOSTS.some(h => host.includes(h))) {
    return context.rewrite('/my-daily-tools.html');
  }

  // tools.you-the-winner.com, daily-tools.you-the-winner.com, and the netlify.app preview subdomain
  return context.rewrite('/daily-tools-landing.html');
};

export const config = { path: '/' };
