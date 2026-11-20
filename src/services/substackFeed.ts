export const substackFeedEndpoint = '/api/substack-feed';
export const substackFeedHeader = 'x-substack-feed';

export function isSubstackHost(url: URL): boolean {
  return /(^|\.)substack\.com\.?$/.test(url.hostname);
}

export function isPrivateSubstackFeed(url: URL): boolean {
  return isSubstackHost(url) && url.pathname.startsWith('/feed/podcast/')
    && (url.pathname.includes('/private/') || url.search.length > 0);
}
