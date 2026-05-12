# Unit of Work Story Map — Hospital Management Platform (HMS)

All 27 user stories mapped to their respective units.

---

## Unit 1: Foundation

| Story ID | Title | Roles |
|---|---|---|
| US-SA-01 | Hospital Onboarding | Super Admin |
| US-SA-02 | Invite Link Management | Super Admin |
| US-HA-01 | Initial Hospital Setup and Branding | Hospital Admin |
| US-HA-02 | User Account and Role Management | Hospital Admin |
| US-HR-01 | Staff Account Management | HR |
| US-ST-01 | System Identity | Staff |
| US-CC-01 | Authentication and Session Management | All Users |

**Story count**: 7  
**Coverage**: Tenant onboarding, branding, user management, authentication, HR, Staff identity

---

## Unit 2: Patient & OPD

| Story ID | Title | Roles |
|---|---|---|
| US-RC-01 | Patient Registration and Medical Card | Receptionist |
| US-NU-01 | Patient Registration Assistance | Nurse |
| US-RC-02 | OPD Visit Creation | Receptionist |
| US-DR-01 | OPD Consultation Management | Doctor |
| US-MG-01 | OPD Queue Oversight | Manager |

**Story count**: 5  
**Coverage**: Patient registration, Medical Card, OPD lifecycle, queue management

---

## Unit 3: IPD

| Story ID | Title | Roles |
|---|---|---|
| US-RC-03 | IPD Admission Creation | Receptionist |
| US-DR-02 | IPD Patient Management | Doctor |
| US-NU-02 | IPD Ward Monitoring | Nurse |
| US-MG-02 | IPD Bed Occupancy Management | Manager |

**Story count**: 4  
**Coverage**: IPD admissions, bed registry, progress notes, discharge, occupancy summary

---

## Unit 4: Lab & Inventory

| Story ID | Title | Roles |
|---|---|---|
| US-RC-04 | Lab Test Request Submission | Receptionist |
| US-DR-03 | Lab Test Requests and Results | Doctor |
| US-PT-01 | Pathology Report Management | Pathologist |
| US-RL-01 | Radiology Report Management | Radiologist |
| US-AD-01 | Inventory Management | Admin |
| US-MG-03 | Inventory Oversight | Manager |

**Story count**: 6  
**Coverage**: Pathology requests + reports, radiology requests + reports, inventory CRUD, low-stock alerts

---

## Unit 5: Payments

| Story ID | Title | Roles |
|---|---|---|
| US-RC-05 | Payment Processing | Receptionist |
| US-FM-01 | Payment Management and Reporting | Finance Manager |
| US-MG-04 | Payment Summary Reporting | Manager |

**Story count**: 3  
**Coverage**: Manual payments, Razorpay integration, receipt generation, payment summary reports

---

## Unit 6: Notifications & Audit

| Story ID | Title | Roles |
|---|---|---|
| US-CC-02 | In-App Notifications | All Users |
| US-MG-05 | Audit Log Access | Manager |

**Story count**: 2  
**Coverage**: WebSocket real-time notifications, notification history, audit log query API

---

## Unit 7: Frontend

| Story ID | Title | Notes |
|---|---|---|
| All 27 stories | Frontend implementation | All user stories get their UI in this unit |

**Story count**: 27 (all stories — frontend surfaces for every story)  
**Coverage**: All 12 frontend components (FC-01 through FC-12), Redux store, RTK Query API slices, WebSocket client, tenant branding, RBAC-aware navigation

---

## Coverage Verification

| Story ID | Unit | Covered |
|---|---|---|
| US-SA-01 | 1 | ✓ |
| US-SA-02 | 1 | ✓ |
| US-HA-01 | 1 | ✓ |
| US-HA-02 | 1 | ✓ |
| US-HR-01 | 1 | ✓ |
| US-ST-01 | 1 | ✓ |
| US-CC-01 | 1 | ✓ |
| US-RC-01 | 2 | ✓ |
| US-NU-01 | 2 | ✓ |
| US-RC-02 | 2 | ✓ |
| US-DR-01 | 2 | ✓ |
| US-MG-01 | 2 | ✓ |
| US-RC-03 | 3 | ✓ |
| US-DR-02 | 3 | ✓ |
| US-NU-02 | 3 | ✓ |
| US-MG-02 | 3 | ✓ |
| US-RC-04 | 4 | ✓ |
| US-DR-03 | 4 | ✓ |
| US-PT-01 | 4 | ✓ |
| US-RL-01 | 4 | ✓ |
| US-AD-01 | 4 | ✓ |
| US-MG-03 | 4 | ✓ |
| US-RC-05 | 5 | ✓ |
| US-FM-01 | 5 | ✓ |
| US-MG-04 | 5 | ✓ |
| US-CC-02 | 6 | ✓ |
| US-MG-05 | 6 | ✓ |

**Total**: 27/27 stories covered ✓
