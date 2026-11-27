import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Podcast, Episode, InlineChapter, TranscriptRef } from '../types';
import { isPrivateSubstackFeed, isSubstackHost, substackFeedEndpoint, substackFeedHeader } from './substackFeed.ts';
import { AndroidHttp, isAndroid } from './android.ts';

const FEED_REQUEST_TIMEOUT_MS = 10_000;
const FEED_ACCEPT = 'application/rss+xml, application/xml, text/xml, application/json';

const MAX_INLINE_CHAPTERS = 100;
/** The largest remote text file (chapters, transcripts) read, matching Android's native HTTP limit. */
export const MAX_REMOTE_TEXT_BYTES = 16 * 1024 * 1024;

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

  return publicSources(url);
}

/** The publisher first, then (on the web) public CORS proxies. */
function publicSources(url: URL): { name: string, url: string, request?: RequestInit }[] {
  const sources = [{ name: 'Publisher', url: url.href }];
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

interface SourceOptions {
  /** A private request on Android, whose failures are reported without the URL. */
  privateNative: boolean;
  /**
   * Asks Android's native HTTP for its private-feed mode, which only allows Substack feed paths and hosts and
   * waits up to 30 s. Only private feeds use it; other private files are plain direct requests.
   */
  nativePrivateFeed: boolean;
  accept: string;
  /** Web requests only send an Accept header when the caller asked for one. */
  sendAccept: boolean;
  deniedMessage: string;
  privateMessage: string;
  relayMessage: string;
  failureMessage: string;
  /** Rejects a response body larger than this many bytes. Feeds leave it unset and are read whole. */
  maxBytes?: number;
}

/**
 * Reads a response body as UTF-8 text, as `response.text()` does, but rejects once it exceeds `maxBytes`: up
 * front when `Content-Length` says so, otherwise while streaming, without reading the rest.
 */
export async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () => new Error(`Response is larger than ${maxBytes} bytes`);
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Tries each source in order and returns the first one `read` accepts. A source that fails, times out, or
 * is rejected by `read` falls through to the next, except private Substack sources, which fail with a
 * PrivateFeedError that never includes the private URL.
 */
async function loadFromSources<T>(
  sources: { name: string, url: string, request?: RequestInit }[],
  options: SourceOptions,
  read: (text: string) => T,
): Promise<T> {
  const errors: Error[] = [];
  const { privateNative } = options;
  for (const source of sources) {
    const controller = new AbortController();
    const relay = source.url === substackFeedEndpoint;
    const timeout = setTimeout(() => controller.abort(), relay ? 30_000 : FEED_REQUEST_TIMEOUT_MS);
    try {
      const native = isAndroid ? await AndroidHttp.get({ url: source.url, privateFeed: options.nativePrivateFeed, accept: options.accept }) : null;
      const request = options.sendAccept
        ? { ...source.request, headers: { Accept: options.accept, ...source.request?.headers } }
        : source.request;
      const response = native ? new Response(native.body || null, { status: native.status }) : await fetch(source.url, {
        ...request,
        credentials: 'omit',
        signal: controller.signal,
      });
      if ((relay || privateNative) && [401, 403, 410].includes(response.status)) {
        throw new PrivateFeedError(options.deniedMessage);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      return read(options.maxBytes === undefined ? await response.text() : await readCappedText(response, options.maxBytes));
    } catch (err) {
      if (err instanceof PrivateFeedError) throw err;
      if (privateNative) throw new PrivateFeedError(options.privateMessage);
      if (relay) throw new PrivateFeedError(options.relayMessage);
      errors.push(new Error(
        `${source.name}: ${controller.signal.aborted ? 'Request timed out' : err instanceof Error ? err.message : 'Request failed'}`,
      ));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AggregateError(errors, options.failureMessage);
}

/**
 * Fetches a remote text file (chapters, transcripts) the way feeds are fetched: the publisher first, then
 * public proxies on the web. `privateSource` limits the request to a direct HTTPS fetch (or plain native HTTP on
 * Android, without the private-feed checks) and never uses a proxy or relay. `accept` defaults to the feed types.
 * A source whose body exceeds `MAX_REMOTE_TEXT_BYTES` fails like any other.
 */
export async function fetchRemoteText(
  url: string,
  { privateSource = false, accept }: { privateSource?: boolean, accept?: string } = {},
): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('Remote files must use HTTP or HTTPS');
  if (privateSource && target.protocol !== 'https:') throw new PrivateFeedError('Private files must use HTTPS.');

  return loadFromSources(
    privateSource ? [{ name: 'Publisher', url: target.href }] : publicSources(target),
    {
      privateNative: isAndroid && privateSource,
      nativePrivateFeed: false,
      accept: accept ?? FEED_ACCEPT,
      sendAccept: accept !== undefined,
      deniedMessage: 'Access to the private file was denied.',
      privateMessage: 'Could not load the private file.',
      relayMessage: 'Could not load the private file.',
      failureMessage: 'Failed to load remote file',
      maxBytes: MAX_REMOTE_TEXT_BYTES,
    },
    text => text,
  );
}

export async function fetchPodcastFeed(feedUrl: string): Promise<{ podcast: Podcast, episodes: Episode[] }> {
  const url = new URL(feedUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Podcast feeds must use HTTP or HTTPS');
  }

  const privateNative = isAndroid && isPrivateSubstackFeed(url);
  return loadFromSources(feedSources(url), {
    privateNative,
    nativePrivateFeed: privateNative,
    accept: FEED_ACCEPT,
    sendAccept: false,
    deniedMessage: 'Substack denied access. Copy your current private podcast feed URL from your subscription settings and try again.',
    privateMessage: 'Could not load the private Substack feed. Check your private RSS link and try again.',
    relayMessage: 'Could not load the private Substack feed. Check your private RSS link and that the app’s feed relay is available.',
    failureMessage: 'Failed to load podcast feed',
  }, xmlText => {
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
        chaptersUrl: parseChaptersUrl(item['podcast:chapters']),
        inlineChapters: parseInlineChapters(item['psc:chapters']),
        transcripts: parseTranscripts(item['podcast:transcript']),
      });
    }

    return { podcast, episodes };
  });
}

function isXmlRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readXmlText(value: unknown): string {
  const text = isXmlRecord(value) ? value['#text'] : value;
  return typeof text === 'string' ? text : '';
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

/** Returns the normalized URL when it is a valid HTTPS URL, otherwise undefined. */
function httpsUrl(value: unknown): string | undefined {
  const text = readXmlText(value).trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function xmlAttribute(node: unknown, name: string): string {
  return isXmlRecord(node) ? readXmlText(node[`@_${name}`]).trim() : '';
}

function parseChaptersUrl(value: unknown): string | undefined {
  for (const node of toArray(value)) {
    const url = isXmlRecord(node) ? httpsUrl(node['@_url']) : undefined;
    if (url) return url;
  }
  return undefined;
}

function parseTranscripts(value: unknown): TranscriptRef[] {
  const transcripts: TranscriptRef[] = [];
  for (const node of toArray(value)) {
    const url = isXmlRecord(node) ? httpsUrl(node['@_url']) : undefined;
    if (!url) continue;
    const language = xmlAttribute(node, 'language');
    const rel = xmlAttribute(node, 'rel');
    transcripts.push({
      url,
      type: xmlAttribute(node, 'type'),
      ...(language && { language }),
      ...(rel && { rel }),
    });
  }
  return transcripts;
}

/** Parses `HH:MM:SS.mmm`, `MM:SS`, `SS` or fractional seconds. Returns NaN when it is not a time. */
function parseChapterStart(value: string): number {
  const parts = value.trim().split(':');
  if (parts.length > 3 || parts.some(part => !/^\d+([.,]\d+)?$/.test(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + Number(part.replace(',', '.')), 0);
}

function parseInlineChapters(value: unknown): InlineChapter[] | undefined {
  const chapters: InlineChapter[] = [];
  for (const container of toArray(value)) {
    if (!isXmlRecord(container)) continue;
    for (const node of toArray(container['psc:chapter'])) {
      const start = parseChapterStart(xmlAttribute(node, 'start'));
      if (!Number.isFinite(start) || !isXmlRecord(node)) continue;
      const url = httpsUrl(node['@_href']);
      const img = httpsUrl(node['@_image']);
      chapters.push({ start, title: xmlAttribute(node, 'title'), ...(url && { url }), ...(img && { img }) });
    }
  }
  return chapters.length ? chapters.sort((a, b) => a.start - b.start).slice(0, MAX_INLINE_CHAPTERS) : undefined;
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
