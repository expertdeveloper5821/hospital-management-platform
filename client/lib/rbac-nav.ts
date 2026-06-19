import type { UserRole } from "@/store/types";

export interface NavItem {
  label: string;
  href: string;
  icon: string; // lucide icon name
}

// Role → visible nav items mapping (derived from requirements RBAC matrix)
const NAV_MAP: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { label: "Tenants", href: "/super-admin", icon: "building-2" },
    {
      label: "Platform Settings",
      href: "/super-admin/platform-settings",
      icon: "settings",
    },
    { label: "Audit Logs", href: "/audit", icon: "file-text" },
  ],
  HOSPITAL_ADMIN: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Departments", href: "/departments", icon: "building-2" },
    { label: "Users", href: "/admin", icon: "users" },
    { label: "Staff", href: "/staff", icon: "file-badge" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Inventory", href: "/inventory", icon: "package" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Billing", href: "/billing", icon: "receipt" },
    { label: "Audit Logs", href: "/audit", icon: "file-text" },
  ],
  MANAGER: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Departments", href: "/departments", icon: "building-2" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Inventory", href: "/inventory", icon: "package" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },

    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Billing", href: "/billing", icon: "receipt" },
    { label: "Audit Logs", href: "/audit", icon: "file-text" },
  ],
  DOCTOR: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Packages", href: "/packages", icon: "gift" },
  ],
  NURSE: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
  ],
  RECEPTIONIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
  ],
  PATHOLOGIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
  ],
  RADIOLOGIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
  ],
  FINANCE_MANAGER: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Billing", href: "/billing", icon: "receipt" },
  ],
  HR: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Users", href: "/admin", icon: "users" },
    { label: "Staff", href: "/staff", icon: "file-badge" },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Departments", href: "/departments", icon: "building-2" },
    { label: "Users", href: "/admin", icon: "users" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Inventory", href: "/inventory", icon: "package" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },

    { label: "Charge Master", href: "/charge-master", icon: "list-checks" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Billing", href: "/billing", icon: "receipt" },
    { label: "Audit Logs", href: "/audit", icon: "file-text" },
  ],
  STAFF: [{ label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" }],
};

export function getNavItems(role: UserRole): NavItem[] {
  return NAV_MAP[role] ?? [];
}
