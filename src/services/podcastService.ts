import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Podcast, Episode } from '../types';

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function fetchPodcastFeed(feedUrl: string): Promise<{ podcast: Podcast, episodes: Episode[] }> {
  try {
    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(feedUrl)}`);
    const xmlText = await response.text();
    const result = xmlParser.parse(xmlText);
    const channel = result.rss?.channel;

    if (!channel) throw new Error('Invalid RSS feed');

    const podcast: Podcast = {
      id: feedUrl,
      title: channel.title || 'Unknown Title',
      author: channel['itunes:author'] || channel.author || 'Unknown Author',
      feedUrl: feedUrl,
      artworkUrl: channel['itunes:image']?.['@_href'] || channel.image?.url || '',
      description: channel.description || '',
    };

    const items = Array.isArray(channel.item) ? channel.item : [channel.item].filter(Boolean);

    const episodes: Episode[] = items.map((item: any) => ({
      id: item.guid?.['#text'] || item.guid || item.link || item.enclosure?.['@_url'] || Math.random().toString(),
      podcastId: feedUrl,
      title: item.title || 'Untitled Episode',
      pubDate: item.pubDate || '',
      audioUrl: item.enclosure?.['@_url'] || '',
      duration: parseDuration(item['itunes:duration'] || '0'),
      description: item.description || item['content:encoded'] || '',
    }));

    return { podcast, episodes };
  } catch (err) {
    console.error('Error fetching feed:', err);
    throw new Error('Failed to fetch podcast feed');
  }
}

function parseDuration(duration: string | number): number {
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
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=10`);
    const data = await response.json();
    return data.results.map((item: any) => ({
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
  const jsonObj = xmlParser.parse(opmlText);
  const outlines = jsonObj.opml?.body?.outline || [];
  const feeds: string[] = [];

  const traverse = (item: any) => {
    if (Array.isArray(item)) {
      item.forEach(traverse);
    } else if (item) {
      if (item['@_xmlUrl']) feeds.push(item['@_xmlUrl']);
      if (item.outline) traverse(item.outline);
    }
  };

  traverse(outlines);
  return feeds;
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
