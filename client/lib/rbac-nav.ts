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
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
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
    { label: "Revenue", href: "/revenue", icon: "trending-up" },
    { label: "Billing", href: "/billing", icon: "receipt" },
    { label: "Audit Logs", href: "/audit", icon: "file-text" },
  ],
  MANAGER: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Departments", href: "/departments", icon: "building-2" },
    { label: "Staff", href: "/staff", icon: "file-badge" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Inventory", href: "/inventory", icon: "package" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },

    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Revenue", href: "/revenue", icon: "trending-up" },
    { label: "Billing", href: "/billing", icon: "receipt" },
  ],
  DOCTOR: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Packages", href: "/packages", icon: "gift" },
  ],
  NURSE: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
  ],
  RECEPTIONIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
  ],
  PATHOLOGIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
  ],
  RADIOLOGIST: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
  ],
  FINANCE_MANAGER: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Revenue", href: "/revenue", icon: "trending-up" },
    { label: "Billing", href: "/billing", icon: "receipt" },
  ],
  HR: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Users", href: "/admin", icon: "users" },
    { label: "Staff", href: "/staff", icon: "file-badge" },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
    { label: "Departments", href: "/departments", icon: "building-2" },
    { label: "Users", href: "/admin", icon: "users" },
    { label: "Staff", href: "/staff", icon: "file-badge" },
    { label: "Patients", href: "/patients", icon: "heart-pulse" },
    { label: "OPD", href: "/opd", icon: "stethoscope" },
    { label: "IPD", href: "/ipd", icon: "bed" },
    { label: "Lab", href: "/lab", icon: "flask-conical" },
    { label: "Inventory", href: "/inventory", icon: "package" },
    { label: "Wards", href: "/wards", icon: "layout-grid" },
    { label: "Packages", href: "/packages", icon: "gift" },
    { label: "Payments", href: "/payments", icon: "credit-card" },
    { label: "Revenue", href: "/revenue", icon: "trending-up" },
    { label: "Billing", href: "/billing", icon: "receipt" },
  ],
  STAFF: [
    { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
    { label: "Attendance", href: "/attendance", icon: "calendar-check" },
  ],
};

export function getNavItems(role: UserRole): NavItem[] {
  return NAV_MAP[role] ?? [];
}
