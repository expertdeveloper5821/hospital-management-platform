'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import {
  useListDocumentsQuery,
  useGetChecklistQuery,
  useUploadDocumentMutation,
  useDeleteDocumentMutation,
} from '@/store/api/staffDocuments.api';
import type { DocumentCategory } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const CATEGORIES: DocumentCategory[] = [
  'IDENTITY_PROOF', 'ADDRESS_PROOF', 'EDUCATIONAL_CERTIFICATE',
  'EXPERIENCE_LETTER', 'OFFER_LETTER', 'CONTRACT', 'OTHER',
];

export default function StaffDocumentsPage() {
  const params  = useParams<{ userId: string }>();
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);

  if (profile && profile.role !== 'HOSPITAL_ADMIN' && profile.role !== 'HR') {
    router.replace('/dashboard');
    return null;
  }

  const { data: checklist } = useGetChecklistQuery(params.userId);
  const { data: documents } = useListDocumentsQuery(params.userId);
  const [upload, { isLoading: uploading }] = useUploadDocumentMutation();
  const [deleteDoc] = useDeleteDocumentMutation();

  const fileRef   = useRef<HTMLInputElement>(null);
  const [category, setCategory]     = useState<DocumentCategory>('IDENTITY_PROOF');
  const [docName, setDocName]       = useState('');
  const [uploadError, setUploadError] = useState('');

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    const file = fileRef.current?.files?.[0];
    if (!file || !docName.trim()) { setUploadError('File and document name are required.'); return; }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) { setUploadError('Only PDF, JPEG, and PNG files are allowed.'); return; }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('documentName', docName.trim());

    try {
      await upload({ userId: params.userId, formData }).unwrap();
      setDocName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setUploadError('Upload failed. Please try again.');
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Delete this document?')) return;
    await deleteDoc(documentId);
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Staff Documents</h1>
      <p className="text-muted-foreground text-sm">User ID: {params.userId}</p>

      {checklist && (
        <Card>
          <CardHeader><CardTitle className="text-base">Onboarding Checklist</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {checklist.map((item) => (
                <div key={item.category} className="flex items-center justify-between border rounded p-2">
                  <span className="capitalize">{item.category.replace(/_/g, ' ').toLowerCase()}</span>
                  <Badge variant={item.status === 'complete' ? 'default' : 'secondary'}>
                    {item.status === 'complete' ? '✓' : '✗'} {item.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Upload Document</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <Label>Category *</Label>
              <select
                className="w-full border rounded px-3 py-2 text-sm mt-1"
                value={category}
                onChange={e => setCategory(e.target.value as DocumentCategory)}
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="docname">Document Name *</Label>
              <Input id="docname" value={docName} onChange={e => setDocName(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="file">File * (PDF, JPG, PNG — max 10 MB)</Label>
              <input id="file" type="file" ref={fileRef} accept=".pdf,.jpg,.jpeg,.png" className="mt-1" />
            </div>
            {uploadError && <p className="text-red-600 text-sm">{uploadError}</p>}
            <Button type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>
          </form>
        </CardContent>
      </Card>

      {documents && documents.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Documents ({documents.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.documentId} className="flex items-start justify-between border rounded p-3 text-sm">
                <div className="space-y-1">
                  <p className="font-medium">{doc.documentName}</p>
                  <p className="text-muted-foreground">{doc.category.replace(/_/g, ' ')}</p>
                  <p className="text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</p>
                  <a href={doc.presignedUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline">Download</a>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleDelete(doc.documentId)}>Delete</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {documents && documents.length === 0 && (
        <p className="text-muted-foreground">No documents uploaded yet.</p>
      )}
    </div>
  );
}
