# U7-G: Notifications + Audit — Code Generation Plan

**Unit Branch**: feature/U7-G  
**Sprint**: Sprint 7  
**Frontend Components**: FC-11 (Notification Panel), FC-12 (Audit Log Viewer)

---

## FC-11: Notification Panel

### Files Created / Modified
| File | Change |
|---|---|
| `store/types.ts` | Added `title`, `entityType?`, `entityId?` to `NotificationMessage` |
| `lib/websocket-client.ts` | Fixed WS message parsing — extracts `{ type, data }` envelope, maps `notificationId → id`, `isRead → read`, `createdAt → timestamp` |
| `store/api/notification.api.ts` | Fixed response shape (backend returns `INotification[]`, not paginated); added `mapNotification()` helper |
| `components/shared/NotificationBell.tsx` | Full FC-11 slide-out panel: API history merge, title display, mark-read via API + Redux, WS live indicator, outside-click dismiss |
| `store/slices/notification.slice.test.ts` | Updated test fixtures to include required `title` field |

### Key behaviours
- Panel opens → `useListNotificationsQuery(limit=30)` fetches persisted history from `/api/notifications`
- WS messages prepended; API history deduped by `id` and appended
- Click item → `PATCH /api/notifications/:id/read` + `dispatch(markRead(id))`
- "Mark all read" → `dispatch(markAllRead())` + fire-and-forget per-item PATCH calls
- Unread count: WS-driven slice count takes precedence; API count seeds on mount
- WS live indicator (Wifi / WifiOff icon)

---

## FC-12: Audit Log Viewer

### Files Created / Modified
| File | Change |
|---|---|
| `store/types.ts` | Added `AuditEntityTypes[]`, `AuditEntityType`, `AuditLogEntry`, `AuditListResult` |
| `store/api/audit.api.ts` | Implemented `listAuditLogs` RTK Query (was empty `export {}`) |
| `app/(dashboard)/audit/page.tsx` | Created FC-12 Audit Log Viewer page |

### Key behaviours
- Filters: entityType (select from all 10 enum values), entityId (text), userId (text), dateFrom (date), dateTo (date)
- Press Enter in any field or click Search → `GET /api/audit?...`
- Results table: Entity Type chip, Entity ID (truncated mono), Action (colour-coded badge), User ID (truncated mono), Timestamp
- Pagination: prev/next with page counter
- Role guard: renders "Access Restricted" for roles other than `HOSPITAL_ADMIN` / `SUPER_ADMIN` (matches backend `requireRole`)
- Refresh button

---

## Acceptance criteria met
- [x] Notification panel shows title + message with UNREAD/READ distinction
- [x] New WS notifications arrive in real time and appear in panel immediately
- [x] History loaded from API on panel open (last 30 notifications)
- [x] Mark individual as read via API; mark all read available
- [x] Unread badge on bell icon is WebSocket-driven
- [x] Audit log query filters by entityType, entityId, userId, dateRange
- [x] Audit page only accessible to HOSPITAL_ADMIN and SUPER_ADMIN
