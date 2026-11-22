import type { Batch } from './profileChanges.ts';

const filesUrl = 'https://www.googleapis.com/drive/v3/files';
const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const requestTimeout = 15_000;

export class DriveError extends Error {
  status: number;
  constructor(status: number) {
    super(`Drive request failed (HTTP ${status})`);
    this.status = status;
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
    if (!response.ok) throw new DriveError(response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

interface DriveFile { id: string; name: string }

async function listFiles(token: string, query: string) {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder', q: `trashed = false and ${query}`,
      fields: 'nextPageToken,files(id,name)', pageSize: '1000', orderBy: 'createdTime',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = JSON.parse(await driveFetch(token, `${filesUrl}?${params}`));
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

export async function allocateFileId(token: string): Promise<string> {
  const response = await driveFetch(token, `${filesUrl}/generateIds?count=1&space=appDataFolder`);
  const id = JSON.parse(response).ids?.[0];
  if (typeof id !== 'string' || !id) throw new Error('Drive did not reserve a file ID');
  return id;
}

export async function listBatches(token: string, profileId: string) {
  const escapedId = profileId.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return listFiles(token, `appProperties has { key='profile' and value='${escapedId}' }`);
}

export async function uploadBatch(token: string, profileId: string, fileId: string, batch: Batch) {
  try {
    await createFile(token, { id: fileId, name: batch.id, appProperties: { profile: profileId } }, JSON.stringify(batch));
  } catch (error) {
    // Drive returns 409 when a previous create with this reserved ID succeeded.
    if (!(error instanceof DriveError && error.status === 409)) throw error;
  }
}
