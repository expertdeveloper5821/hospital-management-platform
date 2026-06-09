'use client';

import { useState } from 'react';
import {
  useListInventoryItemsQuery,
  useCreateInventoryItemMutation,
  useUpdateStockMutation,
  useUpdateThresholdMutation,
  useUpdateInventoryItemMutation,
  useDeleteInventoryItemMutation,
  useGetStockHistoryQuery,
} from '@/store/api/inventory.api';
import { useAppSelector } from '@/store/hooks';
import type {
  InventoryItemResponse,
  CreateInventoryItemRequest,
  UpdateInventoryItemRequest,
  AuditLogEntry,
} from '@/store/types';
import { Button }                        from '@/components/ui/button';
import { Input }                         from '@/components/ui/input';
import { Label }                         from '@/components/ui/label';
import { Badge }                         from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Package,
  Plus,
  X,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Settings,
  Pencil,
  Trash2,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Create Item Modal ────────────────────────────────────────────────────────

interface CreateItemModalProps {
  onClose: () => void;
}

function CreateItemModal({ onClose }: CreateItemModalProps) {
  const [form, setForm] = useState<CreateInventoryItemRequest>({
    name:              '',
    category:          '',
    unit:              '',
    quantity:          0,
    lowStockThreshold: 0,
    description:       '',
  });
  const [error, setError] = useState('');
  const [createItem, { isLoading }] = useCreateInventoryItemMutation();

  function set<K extends keyof CreateInventoryItemRequest>(field: K, value: CreateInventoryItemRequest[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim())     { setError('Name is required.'); return; }
    if (!form.category.trim()) { setError('Category is required.'); return; }
    if (!form.unit.trim())     { setError('Unit is required.'); return; }

    try {
      await createItem({
        ...form,
        description: form.description?.trim() || undefined,
      }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to create item.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Add Inventory Item</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ci-name">Name *</Label>
              <Input
                id="ci-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Surgical Gloves, Paracetamol 500mg…"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ci-category">Category *</Label>
              <Input
                id="ci-category"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                placeholder="e.g. Consumable, Equipment, Medicine…"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ci-unit">Unit *</Label>
              <Input
                id="ci-unit"
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="e.g. Box, Piece, Bottle, Pair…"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ci-qty">Initial Quantity *</Label>
              <Input
                id="ci-qty"
                type="number"
                min={0}
                step={1}
                value={form.quantity}
                onChange={(e) => set('quantity', parseInt(e.target.value, 10) || 0)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ci-threshold">Low Stock Threshold *</Label>
              <Input
                id="ci-threshold"
                type="number"
                min={0}
                step={1}
                value={form.lowStockThreshold}
                onChange={(e) => set('lowStockThreshold', parseInt(e.target.value, 10) || 0)}
                required
              />
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ci-desc">Description (optional)</Label>
              <textarea
                id="ci-desc"
                rows={2}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Additional details about this item…"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding…' : 'Add Item'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Item Modal ──────────────────────────────────────────────────────────

interface EditItemModalProps {
  item:    InventoryItemResponse;
  onClose: () => void;
}

function EditItemModal({ item, onClose }: EditItemModalProps) {
  const [form, setForm] = useState<UpdateInventoryItemRequest>({
    name:              item.name,
    category:          item.category,
    unit:              item.unit,
    lowStockThreshold: item.lowStockThreshold,
    description:       item.description ?? '',
  });
  const [error, setError] = useState('');
  const [updateItem, { isLoading }] = useUpdateInventoryItemMutation();

  function set<K extends keyof UpdateInventoryItemRequest>(field: K, value: UpdateInventoryItemRequest[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name?.trim())     { setError('Name is required.'); return; }
    if (!form.category?.trim()) { setError('Category is required.'); return; }
    if (!form.unit?.trim())     { setError('Unit is required.'); return; }

    try {
      await updateItem({
        itemId:      item.itemId,
        name:        form.name?.trim(),
        category:    form.category?.trim(),
        unit:        form.unit?.trim(),
        lowStockThreshold: form.lowStockThreshold,
        description: form.description?.trim() || null,
      }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to update item.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Edit Inventory Item</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ei-name">Name *</Label>
              <Input
                id="ei-name"
                value={form.name ?? ''}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ei-category">Category *</Label>
              <Input
                id="ei-category"
                value={form.category ?? ''}
                onChange={(e) => set('category', e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ei-unit">Unit *</Label>
              <Input
                id="ei-unit"
                value={form.unit ?? ''}
                onChange={(e) => set('unit', e.target.value)}
                required
              />
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ei-threshold">Low Stock Threshold</Label>
              <Input
                id="ei-threshold"
                type="number"
                min={0}
                step={1}
                value={form.lowStockThreshold ?? 0}
                onChange={(e) => set('lowStockThreshold', parseInt(e.target.value, 10) || 0)}
              />
              <p className="text-xs text-muted-foreground">To update stock quantity, use the Update Stock action.</p>
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="ei-desc">Description (optional)</Label>
              <textarea
                id="ei-desc"
                rows={2}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

interface DeleteItemModalProps {
  item:    InventoryItemResponse;
  onClose: () => void;
}

function DeleteItemModal({ item, onClose }: DeleteItemModalProps) {
  const [error, setError] = useState('');
  const [deleteItem, { isLoading }] = useDeleteInventoryItemMutation();

  async function handleDelete() {
    setError('');
    try {
      await deleteItem(item.itemId).unwrap();
      onClose();
    } catch (err: any) {
      if (err?.status === 404) {
        setError('Item not found — it may have already been deleted.');
      } else {
        setError(err?.data?.message ?? 'Failed to delete item.');
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold text-destructive">Delete Item</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <p className="text-sm">
            Are you sure you want to delete <span className="font-semibold">{item.name}</span>?
          </p>
          <p className="text-xs text-muted-foreground">
            The item will be soft-deleted and its audit history will be preserved.
          </p>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>
              {isLoading ? 'Deleting…' : 'Delete Item'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stock History Drawer ─────────────────────────────────────────────────────

interface StockHistoryDrawerProps {
  item:    InventoryItemResponse;
  onClose: () => void;
}

function StockHistoryDrawer({ item, onClose }: StockHistoryDrawerProps) {
  const [page, setPage] = useState(1);
  const { data, isFetching } = useGetStockHistoryQuery({ itemId: item.itemId, page });

  const entries     = data?.data ?? [];
  const totalPages  = data?.totalPages ?? 1;
  const total       = data?.total ?? 0;

  function actionLabel(action: string) {
    if (action === 'CREATE') return 'Created';
    if (action === 'DELETE') return 'Deleted';
    return 'Updated';
  }

  function actionColor(action: string) {
    if (action === 'CREATE') return 'text-green-700 bg-green-50 border-green-300';
    if (action === 'DELETE') return 'text-red-700 bg-red-50 border-red-300';
    return 'text-blue-700 bg-blue-50 border-blue-300';
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold">Stock History</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isFetching ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
              <History className="h-8 w-8 opacity-30" />
              No history entries found.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry: AuditLogEntry) => (
                <div key={entry.auditId} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', actionColor(entry.action))}>
                      {actionLabel(entry.action)}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
                  </div>

                  {entry.newValue && Object.keys(entry.newValue).length > 0 && (
                    <div className="space-y-1">
                      {entry.newValue.quantity !== undefined && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">New Quantity</span>
                          <span className="font-medium">{String(entry.newValue.quantity)} {item.unit}</span>
                        </div>
                      )}
                      {entry.previousValue?.quantity !== undefined && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Previous Quantity</span>
                          <span className="font-medium">{String(entry.previousValue.quantity)} {item.unit}</span>
                        </div>
                      )}
                      {Boolean(entry.newValue.reason) && (
                        <div className="flex items-start justify-between text-xs gap-2">
                          <span className="text-muted-foreground shrink-0">Reason</span>
                          <span className="font-medium text-right">{String(entry.newValue.reason)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t">
            <p className="text-xs text-muted-foreground">{total} entr{total !== 1 ? 'ies' : 'y'} · Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stock Update Modal ───────────────────────────────────────────────────────

interface StockUpdateModalProps {
  item:    InventoryItemResponse;
  onClose: () => void;
}

function StockUpdateModal({ item, onClose }: StockUpdateModalProps) {
  const [quantityChange, setQuantityChange] = useState<number>(1);
  const [direction,      setDirection]      = useState<'add' | 'remove'>('add');
  const [reason,         setReason]         = useState('');
  const [error,          setError]          = useState('');

  const [updateStock, { isLoading }] = useUpdateStockMutation();

  const delta = direction === 'add' ? Math.abs(quantityChange) : -Math.abs(quantityChange);
  const newQty = item.quantity + delta;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!reason.trim()) { setError('Reason is required.'); return; }
    if (quantityChange === 0) { setError('Quantity change cannot be zero.'); return; }
    if (newQty < 0) { setError('Stock cannot go below zero.'); return; }

    try {
      await updateStock({
        itemId:         item.itemId,
        quantityChange: delta,
        reason:         reason.trim(),
      }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to update stock.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold">Update Stock</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">Current Stock</span>
            <span className="text-lg font-bold">{item.quantity} {item.unit}</span>
          </div>

          <div className="space-y-1.5">
            <Label>Operation</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDirection('add')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition-colors',
                  direction === 'add'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'hover:bg-muted',
                )}
              >
                <ArrowUp className="h-4 w-4" />
                Add Stock
              </button>
              <button
                type="button"
                onClick={() => setDirection('remove')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 rounded-md border py-2 text-sm font-medium transition-colors',
                  direction === 'remove'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'hover:bg-muted',
                )}
              >
                <ArrowDown className="h-4 w-4" />
                Remove Stock
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="su-qty">Quantity *</Label>
            <Input
              id="su-qty"
              type="number"
              min={1}
              step={1}
              value={quantityChange}
              onChange={(e) => setQuantityChange(parseInt(e.target.value, 10) || 1)}
              required
            />
          </div>

          <div className={cn(
            'flex items-center justify-between rounded-md border px-4 py-2 text-sm',
            newQty < 0 ? 'border-destructive bg-destructive/5 text-destructive' : 'border-border bg-muted/20',
          )}>
            <span className="text-muted-foreground">New Stock</span>
            <span className="font-semibold">{newQty < 0 ? 'Invalid' : `${newQty} ${item.unit}`}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="su-reason">Reason *</Label>
            <Input
              id="su-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Restocking, Usage, Disposal, Audit correction…"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || newQty < 0}>
              {isLoading ? 'Saving…' : 'Update Stock'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Threshold Update Modal ───────────────────────────────────────────────────

interface ThresholdUpdateModalProps {
  item:    InventoryItemResponse;
  onClose: () => void;
}

function ThresholdUpdateModal({ item, onClose }: ThresholdUpdateModalProps) {
  const [threshold, setThreshold] = useState(item.lowStockThreshold);
  const [error,     setError]     = useState('');

  const [updateThreshold, { isLoading }] = useUpdateThresholdMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (threshold < 0) { setError('Threshold cannot be negative.'); return; }

    try {
      await updateThreshold({ itemId: item.itemId, lowStockThreshold: threshold }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to update threshold.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-lg bg-background shadow-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold">Update Low Stock Threshold</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{item.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ut-threshold">Low Stock Threshold ({item.unit})</Label>
            <Input
              id="ut-threshold"
              type="number"
              min={0}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10) || 0)}
              required
            />
            <p className="text-xs text-muted-foreground">
              An alert fires when stock falls below this quantity.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Save Threshold'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Item Detail Panel ────────────────────────────────────────────────────────

interface ItemDetailPanelProps {
  item:      InventoryItemResponse;
  canManage: boolean;
  onClose:   () => void;
}

function ItemDetailPanel({ item, canManage, onClose }: ItemDetailPanelProps) {
  const [showStock,     setShowStock]     = useState(false);
  const [showThreshold, setShowThreshold] = useState(false);

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-0">
      <span className="col-span-2 text-sm text-muted-foreground">{label}</span>
      <span className="col-span-3 text-sm font-medium break-words">{value ?? '—'}</span>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
        <div
          className="relative flex flex-col h-full w-full max-w-md bg-background shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between p-5 border-b shrink-0">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {item.isLowStock && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Low Stock
                  </Badge>
                )}
                <Badge variant="outline">{item.category}</Badge>
              </div>
              <p className="text-base font-semibold">{item.name}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className={cn(
              'flex items-center justify-between rounded-md border px-4 py-3 mb-4',
              item.isLowStock ? 'border-red-300 bg-red-50' : 'border-border bg-muted/20',
            )}>
              <span className="text-sm text-muted-foreground">Current Stock</span>
              <span className={cn('text-2xl font-bold', item.isLowStock && 'text-red-600')}>
                {item.quantity}
                <span className="text-sm font-normal text-muted-foreground ml-1">{item.unit}</span>
              </span>
            </div>

            {row('Category',  item.category)}
            {row('Unit',      item.unit)}
            {row('Threshold', `${item.lowStockThreshold} ${item.unit}`)}
            {row('Description', item.description)}
            {row('Added',     formatDate(item.createdAt))}
            {row('Updated',   formatDate(item.updatedAt))}
          </div>

          {canManage && (
            <div className="shrink-0 p-5 border-t space-y-2">
              <Button className="w-full" onClick={() => setShowStock(true)}>
                <Package className="h-4 w-4 mr-2" />
                Update Stock
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setShowThreshold(true)}>
                <Settings className="h-4 w-4 mr-2" />
                Update Threshold
              </Button>
            </div>
          )}
        </div>
      </div>

      {showStock && (
        <StockUpdateModal
          item={item}
          onClose={() => { setShowStock(false); onClose(); }}
        />
      )}
      {showThreshold && (
        <ThresholdUpdateModal
          item={item}
          onClose={() => { setShowThreshold(false); onClose(); }}
        />
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const role = useAppSelector((s) => s.auth.profile?.role);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryInput,  setCategoryInput]  = useState('');
  const [lowStockOnly,   setLowStockOnly]   = useState(false);
  const [page,           setPage]           = useState(1);
  const [showCreate,     setShowCreate]     = useState(false);
  const [selected,       setSelected]       = useState<InventoryItemResponse | null>(null);
  const [editTarget,     setEditTarget]     = useState<InventoryItemResponse | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<InventoryItemResponse | null>(null);
  const [historyTarget,  setHistoryTarget]  = useState<InventoryItemResponse | null>(null);

  const { data, isFetching, refetch } = useListInventoryItemsQuery({
    category: categoryFilter || undefined,
    lowStock: lowStockOnly || undefined,
    page,
    limit: 10,
  });

  const items      = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const lowStockCount = items.filter((i) => i.isLowStock).length;

  const canManage = ['HOSPITAL_ADMIN', 'MANAGER'].includes(role ?? '');
  const canView   = ['HOSPITAL_ADMIN', 'MANAGER', 'NURSE'].includes(role ?? '');

  function handleCategoryFilter() {
    setCategoryFilter(categoryInput.trim());
    setPage(1);
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Package className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">You do not have access to the inventory module.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {total} item{total !== 1 ? 's' : ''}
            {lowStockOnly && ' (low stock only)'}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        )}
      </div>

      {/* Low stock alert banner */}
      {lowStockCount > 0 && !lowStockOnly && (
        <div
          className="flex items-center gap-3 rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 cursor-pointer hover:bg-yellow-100 transition-colors"
          onClick={() => { setLowStockOnly(true); setPage(1); }}
        >
          <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800">
            <strong>{lowStockCount}</strong> item{lowStockCount !== 1 ? 's are' : ' is'} below the minimum stock threshold.{' '}
            <span className="underline">Show low stock only</span>
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 min-w-48">
          <Label className="text-xs">Filter by Category</Label>
          <div className="flex gap-2">
            <Input
              placeholder="Category…"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCategoryFilter()}
              className="h-9"
            />
            <Button variant="outline" size="sm" onClick={handleCategoryFilter} className="h-9 px-3">
              Apply
            </Button>
            {categoryFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => { setCategoryFilter(''); setCategoryInput(''); setPage(1); }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 h-9">
          <input
            id="lowStockToggle"
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => { setLowStockOnly(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="lowStockToggle" className="text-sm cursor-pointer select-none">
            Low stock only
          </label>
        </div>

        <Button variant="outline" size="sm" className="h-9" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {/* Inventory table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Inventory List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isFetching ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Package className="h-8 w-8 opacity-30" />
              {lowStockOnly ? 'No low-stock items.' : 'No inventory items found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Category</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Quantity</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Threshold</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.itemId}
                      className={cn(
                        'border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/30',
                        item.isLowStock && 'bg-red-50/40',
                      )}
                      onClick={() => setSelected(item)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">{item.category}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                        {item.category}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {item.quantity}
                        <span className="text-xs font-normal text-muted-foreground ml-1">{item.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell text-muted-foreground tabular-nums">
                        {item.lowStockThreshold} {item.unit}
                      </td>
                      <td className="px-4 py-3">
                        {item.isLowStock ? (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Low
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-400">OK</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <>
                              <button
                                title="View Stock History"
                                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                onClick={() => setHistoryTarget(item)}
                              >
                                <History className="h-4 w-4" />
                              </button>
                              <button
                                title="Edit Item"
                                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                onClick={() => setEditTarget(item)}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                title="Delete Item"
                                className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                onClick={() => setDeleteTarget(item)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button
                            className="text-xs text-primary hover:underline px-1"
                            onClick={() => setSelected(item)}
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create item modal */}
      {showCreate && (
        <CreateItemModal onClose={() => setShowCreate(false)} />
      )}

      {/* Edit item modal */}
      {editTarget && (
        <EditItemModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteItemModal
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Stock history drawer */}
      {historyTarget && (
        <StockHistoryDrawer
          item={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Item detail panel */}
      {selected && (
        <ItemDetailPanel
          item={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
