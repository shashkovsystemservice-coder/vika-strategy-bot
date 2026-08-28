import { setWebhook } from '../lib/telegram.js';

function isAuthorized(req) {
  const expected = process.env.SETUP_SECRET;
  if (!expected) return false;
  const header = req.headers['x-setup-secret'];
  const query = req.query?.secret;
  return header === expected || query === expected;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false });
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const host = process.env.PUBLIC_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!host) return res.status(500).json({ ok: false, error: 'PUBLIC_BASE_URL or VERCEL_PROJECT_PRODUCTION_URL is required' });

  try {
    const result = await setWebhook(`${host.replace(/\/$/, '')}/api/telegram`);
    return res.status(200).json({ ok: true, webhook: `${host.replace(/\/$/, '')}/api/telegram`, result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
