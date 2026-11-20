import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { isPrivateSubstackFeed, isSubstackHost, substackFeedEndpoint, substackFeedHeader } from '../src/services/substackFeed.ts';

async function serveFeed(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.writeHead(405).end();
    return;
  }

  const header = req.headers[substackFeedHeader];
  let target: URL;
  try {
    target = new URL(typeof header === 'string' ? header : '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!isPrivateSubstackFeed(target)) {
    res.writeHead(400).end();
    return;
  }

  try {
    const signal = AbortSignal.timeout(30_000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (target.protocol !== 'https:' || target.port || target.username || target.password || !isSubstackHost(target)) break;
      const response = await fetch(target, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        redirect: 'manual',
        signal,
      });
      if (response.ok && response.body) {
        await pipeline(response.body, res);
        return;
      }
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (location && [301, 302, 303, 307, 308].includes(response.status)) {
        target = new URL(location, target);
        continue;
      }
      res.writeHead(response.status >= 400 ? response.status : 502).end();
      return;
    }
  } catch {
    // Upstream errors can contain the private URL. Return only the status.
  }
  if (!res.headersSent && !res.destroyed) res.writeHead(502).end();
}

function install(server: ViteDevServer | PreviewServer) {
  server.middlewares.use(substackFeedEndpoint, serveFeed);
}

export const substackFeedPlugin: Plugin = {
  name: 'private-substack-feed',
  configureServer: install,
  configurePreviewServer: install,
};
