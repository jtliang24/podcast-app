import type { Batch } from './profileChanges.ts';

const filesUrl = 'https://www.googleapis.com/drive/v3/files';
const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export class DriveError extends Error {
  status: number;
  constructor(status: number) {
    super(`Drive request failed (HTTP ${status})`);
    this.status = status;
  }
}

async function driveFetch(accessToken: string, url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options, headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
    cache: 'no-store',
  });
  if (!response.ok) throw new DriveError(response.status);
  return response;
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
    const response = await driveFetch(token, `${filesUrl}?${params}`);
    const page = await response.json();
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export async function searchStateFile(token: string, expected?: string | null) {
  const files = await listFiles(token, "name = 'podcast_state.json'");
  return (expected ? files.find(file => file.id === expected) : files[0])?.id ?? null;
}

export async function downloadStateFile(token: string, fileId: string) {
  const response = await driveFetch(token, `${filesUrl}/${encodeURIComponent(fileId)}?alt=media`);
  return response.text();
}

async function createFile(token: string, metadata: object, content: string): Promise<string> {
  const boundary = crypto.randomUUID();
  const part = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`;
  const body = part + JSON.stringify({ ...metadata, parents: ['appDataFolder'], mimeType: 'application/json' })
    + '\r\n' + part + content + `\r\n--${boundary}--\r\n`;
  const response = await driveFetch(token, uploadUrl, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return (await response.json()).id;
}

export function createStateFile(token: string, content: string) {
  return createFile(token, { name: 'podcast_state.json' }, content);
}

export async function allocateFileId(token: string): Promise<string> {
  const response = await driveFetch(token, `${filesUrl}/generateIds?count=1&space=appDataFolder`);
  return (await response.json()).ids[0];
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
