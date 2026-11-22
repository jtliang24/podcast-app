import type { Batch } from './profileChanges.ts';

const filesUrl = 'https://www.googleapis.com/drive/v3/files';
const changesUrl = 'https://www.googleapis.com/drive/v3/changes';
const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const requestTimeout = 15_000;

export class DriveError extends Error {
  status: number;
  retryAt: number;

  constructor(status: number, retryAt = 0) {
    super(`Drive request failed (HTTP ${status})`);
    this.status = status;
    this.retryAt = retryAt;
  }
}

async function driveFetch(accessToken: string, url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeout);
  try {
    const response = await fetch(url, {
      ...options, headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
      cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const retryAt = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry ?? '');
      throw new DriveError(response.status, retryAt || 0);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

interface DriveFile { id: string; name: string }
interface FilePage { files: DriveFile[]; nextPageToken?: string }

async function listFilePage(token: string, query: string, pageToken = ''): Promise<FilePage> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder', q: `trashed = false and ${query}`,
    fields: 'nextPageToken,files(id,name)', pageSize: '1000', orderBy: 'createdTime',
  });
  if (pageToken) params.set('pageToken', pageToken);
  return JSON.parse(await driveFetch(token, `${filesUrl}?${params}`));
}

async function listFiles(token: string, query: string) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listFilePage(token, query, pageToken);
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export async function searchStateFile(token: string, expected?: string | null) {
  const files = await listFiles(token, "name = 'podcast_state.json'");
  return (expected ? files.find(file => file.id === expected) : files[0])?.id ?? null;
}

export function downloadStateFile(token: string, fileId: string) {
  return driveFetch(token, `${filesUrl}/${encodeURIComponent(fileId)}?alt=media`);
}

async function createFile(token: string, metadata: object, content: string): Promise<string> {
  const boundary = crypto.randomUUID();
  const part = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`;
  const body = part + JSON.stringify({ ...metadata, parents: ['appDataFolder'], mimeType: 'application/json' })
    + '\r\n' + part + content + `\r\n--${boundary}--\r\n`;
  const response = await driveFetch(token, uploadUrl, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return JSON.parse(response).id;
}

export function createStateFile(token: string, content: string) {
  return createFile(token, { name: 'podcast_state.json' }, content);
}

export async function reserveFileIds(token: string): Promise<string[]> {
  const response = await driveFetch(token, `${filesUrl}/generateIds?count=20&space=appDataFolder`);
  const { ids } = JSON.parse(response);
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    throw new Error('Drive did not reserve file IDs');
  }
  return ids;
}

export function listBatchPage(token: string, profileId: string, pageToken: string) {
  const escapedId = profileId.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return listFilePage(token, `appProperties has { key='profile' and value='${escapedId}' }`, pageToken);
}

export async function getStartPageToken(token: string): Promise<string> {
  const { startPageToken } = JSON.parse(await driveFetch(token, `${changesUrl}/startPageToken`));
  if (!startPageToken) throw new Error('Drive did not return a start page token');
  return startPageToken;
}

interface ChangePage {
  changes: { removed?: boolean; file?: DriveFile & { trashed?: boolean; appProperties?: Record<string, string> } }[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

export async function listChangePage(token: string, profileId: string, pageToken: string) {
  const params = new URLSearchParams({
    spaces: 'appDataFolder', pageToken, pageSize: '50',
    fields: 'nextPageToken,newStartPageToken,changes(removed,file(id,name,trashed,appProperties))',
  });
  const page: ChangePage = JSON.parse(await driveFetch(token, `${changesUrl}?${params}`));
  const files = page.changes.flatMap(({ removed, file }) =>
    !removed && file && !file.trashed && file.appProperties?.profile === profileId ? [file] : []);
  const nextToken = page.nextPageToken ?? page.newStartPageToken;
  if (!nextToken) throw new Error('Drive did not return a change page token');
  return { files, nextToken, more: !!page.nextPageToken };
}

export async function uploadBatch(token: string, profileId: string, fileId: string, batch: Batch) {
  try {
    await createFile(token, { id: fileId, name: batch.id, appProperties: { profile: profileId } }, JSON.stringify(batch));
  } catch (error) {
    // Drive returns 409 when a previous create with this reserved ID succeeded.
    if (!(error instanceof DriveError && error.status === 409)) throw error;
  }
}
