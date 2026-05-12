# Personas — Hospital Management Platform (HMS)

**Format**: Standard (role title, background, goals, frustrations, day-in-the-life scenario, primary modules)

---

## Persona 1: Super Admin — "SuperAdmin"

**Role Title**: Platform Super Administrator  
**Background**: SuperAdmin works at the HMS product company. He is responsible for onboarding new hospital clients onto the platform, verifying their documents, and ensuring each hospital gets up and running. He has a technical background and is comfortable with admin dashboards.

**Goals**:
- Onboard new hospitals quickly and accurately
- Ensure all required documents are verified before activation
- Monitor the health and status of all tenants on the platform
- Quickly resolve issues like expired invite links

**Frustrations**:
- Manual document verification is time-consuming if the UI doesn't surface missing items clearly
- Losing track of which hospitals are pending vs active vs inactive
- Having to re-send invite links when Hospital Admins don't act in time

**Day-in-the-Life**:
SuperAdmin logs into the platform console each morning, reviews the list of pending hospital onboarding requests, verifies submitted documents, and approves or flags incomplete submissions. He occasionally deactivates tenants that have churned and regenerates invite links for Hospital Admins who missed the 48-hour window.

**Primary Modules**: Tenant Onboarding, Tenant Management

---

## Persona 2: Hospital Admin — "Priya"

**Role Title**: Hospital Administrator  
**Background**: Priya is the IT/operations head at a mid-sized private hospital in Pune. She received the invite email from SuperAdmin and completed the initial setup. She manages all user accounts, configures branding, and ensures the system reflects her hospital's identity.

**Goals**:
- Set up the hospital's branding so all documents look professional
- Create and manage staff accounts with the right roles
- Ensure no unauthorized access to sensitive modules
- Maintain at least one active admin account at all times

**Frustrations**:
- Accidentally assigning the wrong role to a staff member
- Difficulty tracking which staff accounts are active vs deactivated
- Uploading a logo only to find it's rejected due to file size

**Day-in-the-Life**:
Priya logs in after a new staff member joins, creates their account, assigns the appropriate role, and verifies they received the welcome email. She periodically reviews the user list, deactivates accounts for staff who have left, and updates branding when the hospital rebrands.

**Primary Modules**: User Management, Branding Configuration

---

## Persona 3: Manager — "Vikram"

**Role Title**: Hospital Operations Manager  
**Background**: Vikram oversees day-to-day hospital operations at a large hospital in Chennai. He monitors OPD queues, IPD bed occupancy, inventory levels, and payment summaries. He doesn't perform clinical work but needs visibility across all departments.

**Goals**:
- Get a real-time view of OPD queues and IPD bed availability
- Ensure inventory doesn't run out of critical consumables
- Review payment summaries for financial reporting
- Access audit logs when discrepancies arise

**Frustrations**:
- Not knowing which beds are available without calling the ward
- Inventory shortages discovered too late
- Inability to drill into payment data by date range quickly

**Day-in-the-Life**:
Vikram starts his day by checking the OPD queue and IPD bed occupancy dashboard. He reviews low-stock notifications in the inventory module, checks payment summaries for the previous day, and queries audit logs if a staff member reports a data discrepancy.

**Primary Modules**: OPD (read/manage), IPD (manage), Inventory (manage), Payments (read), Audit Logs, User Management (read)

---

## Persona 4: Doctor — "Dr. Meera"

**Role Title**: Consulting Physician  
**Background**: Dr. Meera is a general physician at a hospital in Bengaluru. She sees 20–30 OPD patients daily and manages a handful of IPD admissions. She needs to quickly record consultations, prescriptions, and progress notes without being slowed down by the system.

**Goals**:
- Record OPD consultations and prescriptions quickly
- View a patient's full visit history before a consultation
- Request lab tests and receive notifications when reports are ready
- Write daily progress notes for admitted patients

**Frustrations**:
- Slow or cluttered interfaces that interrupt the consultation flow
- Missing lab results when they're needed during a consultation
- Having to search through paper records for patient history

**Day-in-the-Life**:
Dr. Meera logs in at the start of her OPD session, views her patient queue for the day, opens each patient's record, records the chief complaint, diagnosis, and prescription, and marks the visit complete. For admitted patients, she writes daily progress notes and initiates discharge when ready. She receives in-app notifications when lab reports are completed.

**Primary Modules**: OPD, IPD, Pathology (request/view), Radiology (request/view)

---

## Persona 5: Nurse — "Sunita"

**Role Title**: Ward Nurse  
**Background**: Sunita works in the IPD ward of a hospital in Hyderabad. She assists doctors with admitted patients, monitors ward occupancy, and helps with patient registration when the receptionist is busy.

**Goals**:
- Quickly view all admitted patients in her ward
- Assist with patient registration when needed
- Stay informed about patient status without interrupting doctors

**Frustrations**:
- Not having a clear view of which beds are occupied in her ward
- Having to ask the receptionist for patient details during emergencies

**Day-in-the-Life**:
Sunita starts her shift by reviewing the list of admitted patients in her ward. She checks patient details, assists with any new registrations, and monitors the ward throughout her shift. She reads OPD visit summaries when needed to understand a patient's background.

**Primary Modules**: IPD (manage), Patient Registration (manage), OPD (read)

---

## Persona 6: Receptionist — "Kavya"

**Role Title**: Front Desk Receptionist  
**Background**: Kavya is the first point of contact for patients at a hospital in Mumbai. She registers new patients, creates OPD visits, processes payments, and generates Medical Cards. She handles a high volume of patients daily and needs a fast, reliable interface.

**Goals**:
- Register new patients quickly without creating duplicates
- Generate and print Medical Cards on the spot
- Create OPD visits and assign them to the right doctor
- Process payments and hand receipts to patients

**Frustrations**:
- Accidentally creating duplicate patient records
- Slow PDF generation that holds up the queue
- Confusion about which doctor is available for OPD assignment

**Day-in-the-Life**:
Kavya arrives early and processes a steady stream of patients. She searches for returning patients by mobile number, registers new ones, generates Medical Cards, creates OPD visits, and processes payments throughout the day. She also submits pathology and radiology test requests on behalf of doctors.

**Primary Modules**: Patient Registration, OPD, IPD, Pathology (request), Radiology (request), Payments

---

## Persona 7: Pathologist — "Dr. Rajan"

**Role Title**: Lab Pathologist  
**Background**: Dr. Rajan runs the pathology lab at a hospital in Delhi. He receives test requests from doctors and receptionists, processes samples, and uploads reports. He needs a clear queue of pending requests and a simple upload interface.

**Goals**:
- See all pending pathology test requests in one place
- Upload completed reports quickly and accurately
- Ensure the requesting doctor is notified when a report is ready

**Frustrations**:
- Losing track of which requests have been processed
- Uploading the wrong file to the wrong request
- Large file uploads being rejected without a clear error

**Day-in-the-Life**:
Dr. Rajan logs in each morning, reviews the pending pathology queue, processes samples in the lab, and uploads the corresponding PDF reports one by one. He relies on the system to notify the requesting doctor automatically.

**Primary Modules**: Pathology (manage), Patient records (view)

---

## Persona 8: Radiologist — "Dr. Ananya"

**Role Title**: Radiology Specialist  
**Background**: Dr. Ananya manages the radiology department at a hospital in Kolkata. She handles X-Ray, MRI, CT Scan, and Ultrasound imaging requests. Her workflow mirrors the pathologist's but with larger file sizes and different imaging types.

**Goals**:
- View all pending radiology imaging requests clearly
- Upload imaging reports (which can be large files) without errors
- Ensure requesting doctors are notified promptly

**Frustrations**:
- File size limits that are too restrictive for high-resolution imaging
- Unclear error messages when uploads fail
- Requests not clearly labelled with imaging type

**Day-in-the-Life**:
Dr. Ananya reviews her pending imaging queue, performs or reviews imaging studies, and uploads the corresponding reports. She relies on the system to route notifications to the requesting doctor.

**Primary Modules**: Radiology (manage), Patient records (view)

---

## Persona 9: Finance Manager — "Rohit"

**Role Title**: Finance and Billing Manager  
**Background**: Rohit manages billing and financial reporting at a hospital in Ahmedabad. He processes payments, generates receipts, and produces daily/monthly payment summaries for management. He needs accurate records and easy access to historical receipts.

**Goals**:
- Record all payments accurately with the correct method and amount
- Generate professional, branded receipts instantly
- Produce payment summary reports for any date range
- Retrieve historical receipts when patients request duplicates

**Frustrations**:
- Accidentally entering zero or negative amounts
- Difficulty filtering payments by method or date range
- Receipts that don't reflect the hospital's branding

**Day-in-the-Life**:
Rohit processes payments throughout the day — cash at the counter, UPI via Razorpay, and occasional cheques. He generates receipts for each transaction and ends the day by running a payment summary report for the management team.

**Primary Modules**: Payments (manage), Patient records (view)

---

## Persona 10: HR — "Deepa"

**Role Title**: Human Resources Officer  
**Background**: Deepa manages staff records and onboarding at a hospital in Jaipur. She creates new user accounts for incoming staff and deactivates accounts when staff leave. She works closely with the Hospital Admin but has her own access to User Management.

**Goals**:
- Create new staff accounts quickly when someone joins
- Deactivate accounts promptly when staff leave to prevent unauthorized access
- View the current list of active staff accounts

**Frustrations**:
- Waiting for the Hospital Admin to create accounts during busy periods
- Accidentally deactivating the wrong account

**Day-in-the-Life**:
Deepa creates new user accounts when staff join, assigns the appropriate role in coordination with the Hospital Admin, and deactivates accounts when staff leave. She periodically audits the active user list.

**Primary Modules**: User Management (manage)

---

## Persona 11: Admin — "Suresh"

**Role Title**: Hospital Administrative Staff (Admin Role)  
**Background**: Suresh handles administrative tasks at a hospital in Nagpur, including managing hospital equipment and consumable inventory. He is not a clinical staff member but ensures the hospital is stocked with necessary supplies.

**Goals**:
- Keep inventory records up to date
- Receive alerts before stock runs critically low
- Track the history of stock changes for accountability

**Frustrations**:
- Discovering stock shortages only when supplies run out
- Unclear audit trail for who changed stock quantities

**Day-in-the-Life**:
Suresh logs in daily to update stock quantities after deliveries, reviews low-stock notifications, and adjusts minimum thresholds as needed. He provides stock reports to the Manager on request.

**Primary Modules**: Inventory (manage)

---

## Persona 12: Staff — "Ramesh"

**Role Title**: General Support Staff  
**Background**: Ramesh is a general support staff member (e.g., ward attendant, housekeeping) at a hospital. He has a system account for identity purposes but has no module-level access in this phase.

**Goals**:
- Have a system identity for HR and access control purposes
- Receive system notifications relevant to his role (if any in future phases)

**Frustrations**:
- N/A — no system interaction in this phase

**Day-in-the-Life**:
Ramesh does not interact with the HMS system directly in this phase. His account exists for identity and HR record-keeping purposes.

**Primary Modules**: None (this phase)

---

## Persona-to-Module Mapping

| Persona | Tenant | Users | Patient | OPD | IPD | Pathology | Radiology | Inventory | Payments | Notifications |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Super Admin (Arjun) | ✓ | | | | | | | | | |
| Hospital Admin (Priya) | Branding | ✓ | | | | | | | | ✓ |
| Manager (Vikram) | | Read | ✓ | ✓ | ✓ | Read | Read | ✓ | Read | ✓ |
| Doctor (Dr. Meera) | | | | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| Nurse (Sunita) | | | ✓ | Read | ✓ | | | | | ✓ |
| Receptionist (Kavya) | | | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| Pathologist (Dr. Rajan) | | | | | | ✓ | | | | ✓ |
| Radiologist (Dr. Ananya) | | | | | | | ✓ | | | ✓ |
| Finance Manager (Rohit) | | | | | | | | | ✓ | ✓ |
| HR (Deepa) | | ✓ | | | | | | | | ✓ |
| Admin (Suresh) | | | | | | | | ✓ | | ✓ |
| Staff (Ramesh) | | | | | | | | | | |
