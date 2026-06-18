const MIME_EXT_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png',
};

export function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length < 4) return null;

  // PDF: %PDF → 0x25 0x50 0x44 0x46
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'application/pdf';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return 'image/png';
  }

  return null;
}

export function buildS3Key(
  tenantId:   string,
  userId:     string,
  documentId: string,
  mimeType:   string,
): string {
  const ext = MIME_EXT_MAP[mimeType] ?? 'bin';
  return `tenants/${tenantId}/staff-documents/${userId}/${documentId}.${ext}`;
}
