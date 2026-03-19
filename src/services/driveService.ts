export const DRIVE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

export async function searchStateFile(accessToken: string) {
  const query = encodeURIComponent("name = 'podcast_state.json' and 'appDataFolder' in parents and trashed = false");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id, name)`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to search Drive');
  }
  
  const data = await response.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

export async function downloadStateFile(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to download from Drive');
  }
  
  return await response.text();
}

export async function createStateFile(accessToken: string, fileContent: string) {
  const metadata = {
    name: 'podcast_state.json',
    parents: ['appDataFolder'],
  };
  
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([fileContent], { type: 'application/json' }));
  
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });
  
  if (!response.ok) {
    throw new Error('Failed to create file in Drive');
  }
  
  const data = await response.json();
  return data.id;
}

export async function updateStateFile(accessToken: string, fileId: string, fileContent: string) {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: fileContent,
  });
  
  if (!response.ok) {
    throw new Error('Failed to update file in Drive');
  }
}
