export async function downloadAdminCsv(path: string, query: Record<string, unknown>, filename: string) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '导出失败，请重新登录或缩小筛选范围');
  }
  const blob = await response.blob();
  const objectURL = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectURL; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}
