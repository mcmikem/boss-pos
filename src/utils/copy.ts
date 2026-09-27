// Copying text on a till has to work on the phones this shop actually uses.
// navigator.clipboard needs a secure context AND a permission the user grants;
// on an older Android WebView it exists but every write is denied, which is how
// "Copy support details" — the fastest route to diagnosing a problem — silently
// produced an empty report. The old selection-based path still works there, so
// it is the fallback rather than a second thing to remember at each call site.
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or no clipboard API — fall through to the selection.
  }
  if (typeof document === 'undefined' || !document.body) return false;
  try {
    const area = document.createElement('textarea');
    area.value = value;
    // Off-screen, but not display:none — a hidden element cannot be selected.
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(area);
    return !!ok;
  } catch {
    return false;
  }
}
