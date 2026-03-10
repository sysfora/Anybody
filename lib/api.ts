const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const getProjectStatus = async (username: string, projectName: string) => {
  const response = await fetch(`${API_URL}/api/projects/${username}/${projectName}/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch project status');
  }
  return response.json();
};

export const cancelProject = async (username: string, projectName: string) => {
  const response = await fetch(`${API_URL}/api/projects/${username}/${projectName}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to cancel project');
  }
  return response.json();
};

export const uploadFiles = async (files: File[]): Promise<any[]> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to upload files');
  }

  const data = await response.json();
  return data.attachments;
};

