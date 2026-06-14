/**
 * EAS Metadata config for Header Watch
 * Run: eas metadata:push
 * Docs: https://docs.expo.dev/eas/metadata/
 */

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  apple: {
    info: {
      'en-US': {
        title: 'Header Watch',
        subtitle: 'Security header drift alerts',

        description: `Header Watch keeps a silent eye on the security headers of any website you care about. Drop in a URL, let it scan, and you get a baseline snapshot. From then on, it checks automatically in the background and notifies you the moment anything changes.

Security headers like Content Security Policy, HSTS, X-Frame-Options, and Permissions-Policy are easy to misconfigure during a deployment, a server migration, or a routine update — and just as easy to miss. Header Watch catches the drift so you don't have to.

Add any URL you want to watch. Header Watch fetches the headers, grades them A+ to F, and stores a baseline. Background checks run every 1, 6, or 24 hours depending on what you set. When something changes you get a push notification with a summary of exactly what was added, removed, or altered.

The drift event log keeps a full history of every change, so you can see precisely when a header was removed or a value was modified. Each watch shows a side-by-side comparison between the baseline and the current state.

Built for developers monitoring their own sites, security engineers keeping tabs on third-party services, or anyone who wants to know the moment a Content Security Policy quietly disappears after a CDN update.

No account required. Everything runs on device.

──

Part of the SecURL suite — passive external security monitoring for the web.

• Cert Watch (free) — monitor TLS certificate expiry and get alerted before a cert lapses or changes issuer.
• SecURL (free, securl.online) — full external security posture scan: headers, TLS, DNS/email trust, third-party surface, and a scored grade from A+ to F.`,

        keywords: [
          'security headers',
          'csp',
          'hsts',
          'monitor',
          'web security',
          'headers',
          'drift',
          'scanner',
          'alert',
        ],

        whatsNew: 'Bug fixes and performance improvements.',
      },
    },
  },
};
