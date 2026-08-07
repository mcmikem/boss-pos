// Downloads on old Android (Chrome 49 / WebView) can silently fail when the
// <a> element isn't attached to the document, so attach it, click, then remove.
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Give the browser a beat to start the download before revoking.
    window.setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      try { URL.revokeObjectURL(url); } catch {}
    }, 1000);
    return true;
  } catch {
    return false;
  }
}
