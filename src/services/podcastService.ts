import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Podcast, Episode } from '../types';

// Using corsproxy.io as primary as it's often faster for direct XML requests
const PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false, // Performance: don't auto-convert strings to numbers
  trimValues: true,
});

export async function fetchPodcastFeed(feedUrl: string): Promise<{ podcast: Podcast, episodes: Episode[] }> {
  let lastError: unknown;

  for (const proxy of PROXIES) {
    try {
      const response = await fetch(`${proxy}${encodeURIComponent(feedUrl)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const xmlText = await response.text();
      const result = xmlParser.parse(xmlText);
      const channel = result.rss?.channel;

      if (!channel) throw new Error('Invalid RSS feed');

      const podcast: Podcast = {
        id: feedUrl,
        title: String(channel.title || 'Unknown Title'),
        author: String(channel['itunes:author'] || channel.author || 'Unknown Author'),
        feedUrl: feedUrl,
        artworkUrl: String(channel['itunes:image']?.['@_href'] || channel.image?.url || ''),
        description: String(channel.description || ''),
      };

      const items = Array.isArray(channel.item) ? channel.item : [channel.item].filter(Boolean);

      const episodes: Episode[] = items.map((item: { guid?: { '#text'?: string } | string, link?: string, enclosure?: { '@_url'?: string }, title?: string, pubDate?: string, description?: string, 'content:encoded'?: string, 'itunes:duration'?: string | number, 'itunes:keywords'?: string }) => ({
        id: String(item.guid instanceof Object ? item.guid['#text'] : item.guid || item.link || item.enclosure?.['@_url'] || Math.random()),
        podcastId: feedUrl,
        title: String(item.title || 'Untitled Episode'),
        pubDate: String(item.pubDate || ''),
        audioUrl: String(item.enclosure?.['@_url'] || ''),
        duration: parseDuration(item['itunes:duration'] || '0'),
        description: String(item.description || item['content:encoded'] || ''),
        keywords: item['itunes:keywords'] ? item['itunes:keywords'].split(',').map(k => k.trim()) : [],
      }));

      return { podcast, episodes };
    } catch (err) {
      console.warn(`Proxy ${proxy} failed:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All proxies failed');
}

function parseDuration(duration: string | number | undefined): number {
  if (duration === undefined) return 0;
  const d = String(duration);
  if (d.includes(':')) {
    const parts = d.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  return parseInt(d, 10) || 0;
}

export async function searchPodcasts(query: string): Promise<Podcast[]> {
  try {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=15`);
    const data = await response.json();
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
