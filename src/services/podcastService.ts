import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Podcast, Episode } from '../types';
import { isPrivateSubstackFeed, isSubstackHost, substackFeedEndpoint, substackFeedHeader } from './substackFeed.ts';
import { AndroidHttp, isAndroid } from './android.ts';

const FEED_REQUEST_TIMEOUT_MS = 10_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false, // Performance: don't auto-convert strings to numbers
  trimValues: true,
});

export class PrivateFeedError extends Error {}

function feedSources(url: URL): { name: string, url: string, request?: RequestInit }[] {
  if (isSubstackHost(url) && /^\/account\/add-podcast\/?$/.test(url.pathname)) {
    throw new PrivateFeedError('Open the Substack setup page, copy the private RSS feed URL, and paste it here.');
  }
  // Try the publisher directly before sending the feed URL to a CORS proxy.
  const sources = [{ name: 'Publisher', url: url.href }];
  if (isPrivateSubstackFeed(url)) {
    if (url.protocol !== 'https:') throw new PrivateFeedError('Use the HTTPS link from Substack’s private podcast feed settings.');
    if (isAndroid) return sources;
    return [...sources, {
      name: 'Substack relay',
      url: substackFeedEndpoint,
      request: { method: 'POST', redirect: 'error', headers: { [substackFeedHeader]: url.href } },
    }];
  }

  if (isAndroid) return sources;

  const encodedUrl = encodeURIComponent(url.href);
  const proxyKey = import.meta.env?.VITE_CORSPROXY_KEY?.trim();
  if (proxyKey) {
    sources.push({
      name: 'CorsProxy',
      url: `https://corsproxy.io/?key=${encodeURIComponent(proxyKey)}&url=${encodedUrl}`,
    });
  }
  sources.push({ name: 'AllOrigins', url: `https://api.allorigins.win/raw?url=${encodedUrl}` });
  return sources;
}

export async function fetchPodcastFeed(feedUrl: string): Promise<{ podcast: Podcast, episodes: Episode[] }> {
  const url = new URL(feedUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Podcast feeds must use HTTP or HTTPS');
  }

  const errors: Error[] = [];
  const privateNative = isAndroid && isPrivateSubstackFeed(url);
  for (const source of feedSources(url)) {
    const controller = new AbortController();
    const relay = source.url === substackFeedEndpoint;
    const timeout = setTimeout(() => controller.abort(), relay ? 30_000 : FEED_REQUEST_TIMEOUT_MS);
    try {
      const native = isAndroid ? await AndroidHttp.get({ url: source.url, privateFeed: privateNative }) : null;
      const response = native ? new Response(native.body || null, { status: native.status }) : await fetch(source.url, {
        ...source.request,
        credentials: 'omit',
        signal: controller.signal,
      });
      if ((relay || privateNative) && [401, 403, 410].includes(response.status)) {
        throw new PrivateFeedError('Substack denied access. Copy your current private podcast feed URL from your subscription settings and try again.');
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const xmlText = await response.text();
      const result = xmlParser.parse(xmlText);
      const channel = result.rss?.channel;

      if (!isXmlRecord(channel)) {
        throw new Error('Invalid RSS feed');
      }

      const podcast: Podcast = {
        id: feedUrl,
        title: readXmlText(channel.title) || 'Unknown Title',
        author: readXmlText(channel['itunes:author']) || readXmlText(channel.author) || 'Unknown Author',
        feedUrl: feedUrl,
        artworkUrl: readXmlText(isXmlRecord(channel['itunes:image']) ? channel['itunes:image']['@_href'] : undefined)
          || readXmlText(isXmlRecord(channel.image) ? channel.image.url : undefined),
        description: readXmlText(channel.description),
      };

      const items: unknown[] = Array.isArray(channel.item) ? channel.item : [channel.item];
      const episodes: Episode[] = [];
      for (const [index, item] of items.entries()) {
        if (!isXmlRecord(item)) continue;

        const enclosures = Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure];
        const enclosure = enclosures.find(value => isXmlRecord(value) && readXmlText(value['@_url']));
        const audioUrl = isXmlRecord(enclosure) ? readXmlText(enclosure['@_url']) : '';
        const title = readXmlText(item.title) || 'Untitled Episode';
        const pubDate = readXmlText(item.pubDate);
        const keywordNodes = Array.isArray(item['itunes:keywords'])
          ? item['itunes:keywords']
          : [item['itunes:keywords']];

        episodes.push({
          id: readXmlText(item.guid) || readXmlText(item.link) || audioUrl || JSON.stringify([feedUrl, title, pubDate, index]),
          podcastId: feedUrl,
          title,
          pubDate,
          audioUrl,
          duration: parseDuration(readXmlText(item['itunes:duration'])),
          description: readXmlText(item.description) || readXmlText(item['content:encoded']),
          keywords: keywordNodes.flatMap(node => readXmlText(node).split(','))
            .map(keyword => keyword.trim()).filter(Boolean),
        });
      }

      return { podcast, episodes };
    } catch (err) {
      if (err instanceof PrivateFeedError) throw err;
      if (privateNative) throw new PrivateFeedError('Could not load the private Substack feed. Check your private RSS link and try again.');
      if (relay) throw new PrivateFeedError('Could not load the private Substack feed. Check your private RSS link and that the app’s feed relay is available.');
      errors.push(new Error(
        `${source.name}: ${controller.signal.aborted ? 'Request timed out' : err instanceof Error ? err.message : 'Request failed'}`,
      ));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AggregateError(errors, 'Failed to load podcast feed');
}

function isXmlRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readXmlText(value: unknown): string {
  const text = isXmlRecord(value) ? value['#text'] : value;
  return typeof text === 'string' ? text : '';
}

function parseDuration(duration: string): number {
  const parts = duration.trim().split(':');
  if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part.trim()))) return 0;

  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? (parts.length === 1 ? Math.trunc(seconds) : seconds) : 0;
}

export async function searchPodcasts(query: string): Promise<Podcast[]> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=15`;
    const response = isAndroid ? await AndroidHttp.get({ url }) : await fetch(url);
    if (response.status !== 200) throw new Error('Podcast search failed');
    const data = 'json' in response ? await response.json() : JSON.parse(response.body);
    return data.results.map((item: { feedUrl: string, collectionName: string, artistName: string, artworkUrl600?: string, artworkUrl100?: string }) => ({
      id: item.feedUrl,
      title: item.collectionName,
      author: item.artistName,
      feedUrl: item.feedUrl,
      artworkUrl: item.artworkUrl600 || item.artworkUrl100,
      description: '',
    }));
  } catch (err) {
    console.error('Error searching podcasts:', err);
    return [];
  }
}

export function parseOPML(opmlText: string): string[] {
  try {
    const jsonObj = xmlParser.parse(opmlText) as Record<string, unknown>;
    const feeds: string[] = [];

    const traverse = (item: unknown) => {
      if (Array.isArray(item)) {
        item.forEach(traverse);
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        // Try to find the feed URL in common OPML attribute variations
        const xmlUrl = obj['@_xmlUrl'] || obj['@_xmlurl'] || obj['@_XMLURL'];
        if (xmlUrl) {
          feeds.push(String(xmlUrl));
        }
        
        // Continue traversing all properties to find nested outlines or other structures
        Object.keys(obj).forEach(key => {
          if (key !== '@_xmlUrl' && key !== '@_xmlurl' && key !== '@_XMLURL') {
            traverse(obj[key]);
          }
        });
      }
    };

    traverse(jsonObj);
    // Return unique URLs
    return [...new Set(feeds)];
  } catch (err) {
    console.error('Error parsing OPML:', err);
    return [];
  }
}

export function generateOPML(podcasts: Podcast[]): string {
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const opmlObj = {
    opml: {
      '@_version': '2.0',
      head: { title: 'Podcast Subscriptions' },
      body: {
        outline: podcasts.map(p => ({
          '@_text': p.title,
          '@_title': p.title,
          '@_type': 'rss',
          '@_xmlUrl': p.feedUrl,
          '@_htmlUrl': p.feedUrl,
        })),
      },
    },
  };
  return builder.build(opmlObj);
}
