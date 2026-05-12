# Component Methods — Hospital Management Platform (HMS)

**Note**: Method signatures define interfaces and input/output types. Detailed business rules and validation logic are deferred to Functional Design (per-unit, Construction phase).

---

## BC-01: Auth Module — AuthService

```typescript
// AuthService — aidlc-docs/inception/application-design/component-methods.md

interface LoginInput {
  email: string;
  password: string;
}
interface LoginResult {
  token: string;        // signed JWT
  user: UserProfile;
  requiresPasswordChange: boolean;
}
login(input: LoginInput): Promise<LoginResult>

interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}
changePassword(input: ChangePasswordInput): Promise<void>

logout(token: string): Promise<void>   // adds token to denylist

interface ForgotPasswordInput { email: string; tenantId: string; }
forgotPassword(input: ForgotPasswordInput): Promise<void>

interface ResetPasswordInput { resetToken: string; newPassword: string; }
resetPassword(input: ResetPasswordInput): Promise<void>

validateJWT(token: string): Promise<JWTPayload>   // throws on invalid/expired/denylisted

// AuthRepository
findUserByEmail(email: string, tenantId: string): Promise<User | null>
findSuperAdminByEmail(email: string): Promise<SuperAdmin | null>
incrementFailedAttempts(userId: string): Promise<void>
lockAccount(userId: string, until: Date): Promise<void>
unlockAccount(userId: string): Promise<void>
recordPasswordChange(userId: string, hashedPassword: string): Promise<void>
saveResetToken(userId: string, token: string, expiresAt: Date): Promise<void>
consumeResetToken(token: string): Promise<User | null>
```

---

## BC-02: Tenant Module — TenantService

```typescript
interface CreateTenantInput {
  hospitalName: string;
  adminEmail: string;
  documents: {
    registrationCertificate: string;  // S3 key
    gstNumber: string;
    panCard: string;                  // S3 key
    addressProof: string;             // S3 key
  };
}
createTenant(input: CreateTenantInput, superAdminId: string): Promise<Tenant>

approveTenant(tenantId: string, superAdminId: string): Promise<Tenant>
deactivateTenant(tenantId: string, superAdminId: string): Promise<Tenant>
listTenants(page: number, limit: number): Promise<PaginatedResult<Tenant>>
resendInvite(tenantId: string, superAdminId: string): Promise<void>

interface SetupInput {
  inviteToken: string;
  adminName: string;
  password: string;
}
completeTenantSetup(input: SetupInput): Promise<User>   // creates Hospital Admin user

interface BrandingInput {
  displayName?: string;
  primaryColor?: string;
  logoFile?: Buffer;   // max 2 MB enforced in service
}
updateBranding(tenantId: string, input: BrandingInput): Promise<TenantBranding>
getBranding(tenantId: string): Promise<TenantBranding>

// TenantRepository
findById(tenantId: string): Promise<Tenant | null>
save(tenant: Tenant): Promise<Tenant>
updateStatus(tenantId: string, status: TenantStatus): Promise<void>
updateBranding(tenantId: string, branding: TenantBranding): Promise<void>
```

---

## BC-03: User Module — UserService

```typescript
interface CreateUserInput {
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
}
createUser(input: CreateUserInput, createdBy: string): Promise<User>

deactivateUser(userId: string, tenantId: string, requestedBy: string): Promise<void>
updateUserRole(userId: string, newRole: UserRole, tenantId: string, updatedBy: string): Promise<User>
listUsers(tenantId: string, filters: UserFilters, page: number, limit: number): Promise<PaginatedResult<User>>
getUserById(userId: string, tenantId: string): Promise<User | null>

// UserRepository
findById(userId: string): Promise<User | null>
findByEmail(email: string, tenantId: string): Promise<User | null>
countActiveAdmins(tenantId: string): Promise<number>
save(user: User): Promise<User>
updateRole(userId: string, role: UserRole): Promise<void>
setActive(userId: string, active: boolean): Promise<void>
```

---

## BC-04: Patient Module — PatientService

```typescript
interface CreatePatientInput {
  tenantId: string;
  fullName: string;
  dateOfBirth: Date;
  gender: 'Male' | 'Female' | 'Other';
  mobileNumber: string;
  address: string;
  aadhaarNumber?: string;
  emergencyContactName?: string;
  emergencyContactMobile?: string;
  bloodGroup?: string;
  forceCreate?: boolean;   // bypass duplicate warning
}
createPatient(input: CreatePatientInput, createdBy: string): Promise<{ patient: Patient; isDuplicate: boolean }>

updatePatient(patientId: string, updates: Partial<PatientDemographics>, tenantId: string, updatedBy: string): Promise<Patient>
searchPatients(tenantId: string, query: PatientSearchQuery): Promise<Patient[]>
getPatientById(patientId: string, tenantId: string): Promise<Patient | null>
generateMedicalCard(patientId: string, tenantId: string): Promise<Buffer>   // returns PDF buffer

// PatientRepository
findByMobile(mobileNumber: string, tenantId: string): Promise<Patient | null>
findById(patientId: string, tenantId: string): Promise<Patient | null>
search(tenantId: string, query: PatientSearchQuery): Promise<Patient[]>
save(patient: Patient): Promise<Patient>
update(patientId: string, updates: Partial<Patient>): Promise<Patient>
```

---

## BC-05: OPD Module — OPDService

```typescript
interface CreateVisitInput {
  tenantId: string;
  patientId: string;
  doctorId: string;
  visitDate: Date;
}
createVisit(input: CreateVisitInput, createdBy: string): Promise<OPDVisit>

interface UpdateVisitInput {
  chiefComplaint?: string;
  diagnosis?: string;
  prescription?: string;   // free-text
  followUpDate?: Date;
}
updateVisit(visitId: string, updates: UpdateVisitInput, tenantId: string, updatedBy: string): Promise<OPDVisit>
completeVisit(visitId: string, tenantId: string, doctorId: string): Promise<OPDVisit>
getQueue(tenantId: string, date: Date, doctorId?: string): Promise<OPDVisit[]>
getVisitById(visitId: string, tenantId: string): Promise<OPDVisit | null>
getPatientHistory(patientId: string, tenantId: string): Promise<OPDVisit[]>

// OPDRepository
findById(visitId: string, tenantId: string): Promise<OPDVisit | null>
findByDate(tenantId: string, date: Date, doctorId?: string): Promise<OPDVisit[]>
findByPatient(patientId: string, tenantId: string): Promise<OPDVisit[]>
save(visit: OPDVisit): Promise<OPDVisit>
updateStatus(visitId: string, status: OPDStatus, completedAt?: Date): Promise<void>
```

---

## BC-06: IPD Module — IPDService

```typescript
// Ward & Bed Registry
interface CreateWardInput { tenantId: string; wardName: string; totalBeds: number; }
createWard(input: CreateWardInput, createdBy: string): Promise<Ward>
addBeds(wardId: string, bedNumbers: string[], tenantId: string): Promise<Ward>
listWards(tenantId: string): Promise<Ward[]>

// Admissions
interface CreateAdmissionInput {
  tenantId: string;
  patientId: string;
  doctorId: string;
  wardId: string;
  bedNumber: string;
  admissionDate: Date;
}
createAdmission(input: CreateAdmissionInput, createdBy: string): Promise<IPDAdmission>
addProgressNote(admissionId: string, note: string, tenantId: string, doctorId: string): Promise<ProgressNote>
dischargePatient(admissionId: string, tenantId: string, doctorId: string): Promise<IPDAdmission>
listAdmissions(tenantId: string, wardId?: string): Promise<IPDAdmission[]>
getAdmissionById(admissionId: string, tenantId: string): Promise<IPDAdmission | null>
getBedOccupancySummary(tenantId: string): Promise<BedOccupancySummary[]>

// IPDRepository
findById(admissionId: string, tenantId: string): Promise<IPDAdmission | null>
findActiveBed(wardId: string, bedNumber: string, tenantId: string): Promise<IPDAdmission | null>
findActiveAdmissions(tenantId: string, wardId?: string): Promise<IPDAdmission[]>
save(admission: IPDAdmission): Promise<IPDAdmission>
updateStatus(admissionId: string, status: IPDStatus, dischargeDate?: Date): Promise<void>
```

---

## BC-07: Lab Module — LabService

```typescript
// Pathology
interface CreatePathologyRequestInput {
  tenantId: string;
  patientId: string;
  testNames: string[];
  requestingDoctorId: string;
}
createPathologyRequest(input: CreatePathologyRequestInput, createdBy: string): Promise<PathologyRequest>
uploadPathologyReport(requestId: string, file: Buffer, mimeType: string, tenantId: string, pathologistId: string): Promise<PathologyRequest>
listPathologyRequests(tenantId: string, filters: LabRequestFilters): Promise<PathologyRequest[]>

// Radiology
interface CreateRadiologyRequestInput {
  tenantId: string;
  patientId: string;
  imagingType: 'X-Ray' | 'MRI' | 'CT Scan' | 'Ultrasound';
  requestingDoctorId: string;
}
createRadiologyRequest(input: CreateRadiologyRequestInput, createdBy: string): Promise<RadiologyRequest>
uploadRadiologyReport(requestId: string, file: Buffer, mimeType: string, tenantId: string, radiologistId: string): Promise<RadiologyRequest>
listRadiologyRequests(tenantId: string, filters: LabRequestFilters): Promise<RadiologyRequest[]>

// LabRepository
findPathologyById(requestId: string, tenantId: string): Promise<PathologyRequest | null>
findRadiologyById(requestId: string, tenantId: string): Promise<RadiologyRequest | null>
findPathologyByPatient(patientId: string, tenantId: string): Promise<PathologyRequest[]>
findRadiologyByPatient(patientId: string, tenantId: string): Promise<RadiologyRequest[]>
findPendingPathology(tenantId: string): Promise<PathologyRequest[]>
findPendingRadiology(tenantId: string): Promise<RadiologyRequest[]>
savePathology(request: PathologyRequest): Promise<PathologyRequest>
saveRadiology(request: RadiologyRequest): Promise<RadiologyRequest>
```

---

## BC-08: Inventory Module — InventoryService

```typescript
interface CreateInventoryItemInput {
  tenantId: string;
  itemName: string;
  category: 'Equipment' | 'Consumable';
  unitOfMeasure: string;
  currentStock: number;
  minimumThreshold: number;
}
createItem(input: CreateInventoryItemInput, createdBy: string): Promise<InventoryItem>

interface UpdateStockInput {
  newQuantity: number;
  reason: string;
}
updateStock(itemId: string, input: UpdateStockInput, tenantId: string, updatedBy: string): Promise<InventoryItem>
updateThreshold(itemId: string, newThreshold: number, tenantId: string, updatedBy: string): Promise<InventoryItem>
listItems(tenantId: string, filters: InventoryFilters): Promise<InventoryItem[]>
getItemById(itemId: string, tenantId: string): Promise<InventoryItem | null>

// InventoryRepository
findById(itemId: string, tenantId: string): Promise<InventoryItem | null>
findAll(tenantId: string, filters: InventoryFilters): Promise<InventoryItem[]>
save(item: InventoryItem): Promise<InventoryItem>
updateStock(itemId: string, quantity: number): Promise<void>
```

---

## BC-09: Payment Module — PaymentService

```typescript
// Manual payment (Cash / Cheque)
interface CreateManualPaymentInput {
  tenantId: string;
  patientId: string;
  amount: number;          // must be > 0
  method: 'Cash' | 'Cheque';
  description: string;
}
createManualPayment(input: CreateManualPaymentInput, createdBy: string): Promise<{ payment: Payment; receiptUrl: string }>

// Razorpay (UPI / Card)
interface CreateRazorpayOrderInput {
  tenantId: string;
  patientId: string;
  amount: number;
  description: string;
}
createRazorpayOrder(input: CreateRazorpayOrderInput, createdBy: string): Promise<{ orderId: string; amount: number; currency: string }>
handleRazorpayWebhook(payload: RazorpayWebhookPayload, signature: string): Promise<void>

// Queries
listPayments(tenantId: string, filters: PaymentFilters): Promise<Payment[]>
getReceiptUrl(paymentId: string, tenantId: string): Promise<string>   // S3 pre-signed URL
getPaymentSummary(tenantId: string, startDate: Date, endDate: Date): Promise<PaymentSummary>

// PaymentRepository
findById(paymentId: string, tenantId: string): Promise<Payment | null>
findByFilters(tenantId: string, filters: PaymentFilters): Promise<Payment[]>
save(payment: Payment): Promise<Payment>
sumByMethod(tenantId: string, startDate: Date, endDate: Date): Promise<PaymentSummary>
```

---

## BC-10: Notification Module — NotificationService

```typescript
interface CreateNotificationInput {
  tenantId: string;
  recipientUserId: string;
  title: string;
  message: string;
}
sendNotification(input: CreateNotificationInput): Promise<Notification>
sendToRole(tenantId: string, role: UserRole, title: string, message: string): Promise<void>
markAsRead(notificationId: string, userId: string): Promise<void>
listNotifications(userId: string, tenantId: string): Promise<Notification[]>   // last 30 days
getUnreadCount(userId: string, tenantId: string): Promise<number>

// WebSocketService (used internally)
registerConnection(userId: string, ws: WebSocket): void
removeConnection(userId: string): void
pushToUser(userId: string, payload: NotificationPayload): void

// NotificationRepository
save(notification: Notification): Promise<Notification>
findByUser(userId: string, tenantId: string, since: Date): Promise<Notification[]>
markRead(notificationId: string): Promise<void>
countUnread(userId: string, tenantId: string): Promise<number>
```

---

## BC-11: Audit Module — AuditService

```typescript
interface AuditEntry {
  tenantId: string;
  entityType: AuditEntityType;   // Patient | OPDVisit | IPDAdmission | PathologyRequest | RadiologyRequest | InventoryItem | Payment | UserAccount
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  previousValue?: Record<string, unknown>;
  newValue: Record<string, unknown>;
  userId: string;
  timestamp: Date;
}
log(entry: AuditEntry): Promise<void>   // fire-and-forget; never throws to caller

interface AuditQueryFilters {
  tenantId: string;
  entityType?: AuditEntityType;
  entityId?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}
queryLogs(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEntry>>

// AuditRepository
save(entry: AuditEntry): Promise<void>
query(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEntry>>
```

---

## Shared Infrastructure Services

```typescript
// SI-01: EmailService
interface SendEmailInput { to: string; subject: string; html: string; }
sendEmail(input: SendEmailInput): Promise<void>

// SI-02: S3Service
uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string>   // returns S3 key
getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>
deleteFile(key: string): Promise<void>

// SI-03: PDFService
generateMedicalCard(patient: Patient, branding: TenantBranding): Promise<Buffer>
generateReceipt(payment: Payment, patient: Patient, branding: TenantBranding): Promise<Buffer>

// SI-04: WebSocketService (see BC-10 above)
```

---

## Express Middleware Stack

```typescript
// Applied globally (all protected routes)
authenticateJWT(req, res, next): void          // validates JWT, attaches req.user
scopeTenant(req, res, next): void              // attaches req.tenantId from JWT, validates tenant ACTIVE
requireFirstPasswordChange(req, res, next): void  // blocks if user.requiresPasswordChange

// Applied per-router
requireRole(...roles: UserRole[]): Middleware  // RBAC check — returns 403 if role not in list
requireReadOnly(module: string): Middleware    // enforces read-only (GET only) for roles with Read access

// Applied globally (all routes)
requestLogger(req, res, next): void            // structured log with correlationId, tenantId, userId
errorHandler(err, req, res, next): void        // global error handler — returns { status, message, details? }
```

---

## Standard Response Shapes

```typescript
// Success response
interface SuccessResponse<T> {
  status: 'success';
  data: T;
}

// Error response (per user decision — Question 8)
interface ErrorResponse {
  status: 'error';
  message: string;
  details?: Record<string, unknown>;
}

// Paginated response
interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
```
