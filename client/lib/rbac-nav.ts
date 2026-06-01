import type { UserRole } from '@/store/types';

export interface NavItem {
  label:  string;
  href:   string;
  icon:   string; // lucide icon name
}

// Role → visible nav items mapping (derived from requirements RBAC matrix)
const NAV_MAP: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { label: 'Tenants',           href: '/super-admin',                  icon: 'building-2' },
    { label: 'Platform Settings', href: '/super-admin/platform-settings', icon: 'settings'   },
    { label: 'Audit Logs',        href: '/audit',                        icon: 'file-text'  },
  ],
  HOSPITAL_ADMIN: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'layout-dashboard' },
    { label: 'Users',      href: '/admin',      icon: 'users'            },
    { label: 'Patients',   href: '/patients',   icon: 'heart-pulse'      },
    { label: 'OPD',        href: '/opd',        icon: 'stethoscope'      },
    { label: 'IPD',        href: '/ipd',        icon: 'bed'              },
    { label: 'Lab',        href: '/lab',        icon: 'flask-conical'    },
    { label: 'Inventory',  href: '/inventory',  icon: 'package'          },
    { label: 'Payments',   href: '/payments',   icon: 'credit-card'      },
    { label: 'Audit Logs', href: '/audit',      icon: 'file-text'        },
  ],
  MANAGER: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'layout-dashboard' },
    { label: 'Patients',   href: '/patients',   icon: 'heart-pulse'      },
    { label: 'OPD',        href: '/opd',        icon: 'stethoscope'      },
    { label: 'IPD',        href: '/ipd',        icon: 'bed'              },
    { label: 'Lab',        href: '/lab',        icon: 'flask-conical'    },
    { label: 'Inventory',  href: '/inventory',  icon: 'package'          },
    { label: 'Payments',   href: '/payments',   icon: 'credit-card'      },
    { label: 'Audit Logs', href: '/audit',      icon: 'file-text'        },
  ],
  DOCTOR: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Patients',  href: '/patients',  icon: 'heart-pulse'      },
    { label: 'OPD',       href: '/opd',       icon: 'stethoscope'      },
    { label: 'IPD',       href: '/ipd',       icon: 'bed'              },
    { label: 'Lab',       href: '/lab',       icon: 'flask-conical'    },
  ],
  NURSE: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Patients',  href: '/patients',  icon: 'heart-pulse'      },
    { label: 'IPD',       href: '/ipd',       icon: 'bed'              },
  ],
  RECEPTIONIST: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Patients',  href: '/patients',  icon: 'heart-pulse'      },
    { label: 'OPD',       href: '/opd',       icon: 'stethoscope'      },
    { label: 'IPD',       href: '/ipd',       icon: 'bed'              },
    { label: 'Payments',  href: '/payments',  icon: 'credit-card'      },
  ],
  PATHOLOGIST: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Lab',       href: '/lab',       icon: 'flask-conical'    },
  ],
  RADIOLOGIST: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Lab',       href: '/lab',       icon: 'flask-conical'    },
  ],
  FINANCE_MANAGER: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Payments',  href: '/payments',  icon: 'credit-card'      },
  ],
  HR: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
    { label: 'Users',     href: '/admin',     icon: 'users'            },
  ],
  ADMIN: [
    { label: 'Dashboard',  href: '/dashboard',  icon: 'layout-dashboard' },
    { label: 'Users',      href: '/admin',      icon: 'users'            },
    { label: 'Patients',   href: '/patients',   icon: 'heart-pulse'      },
    { label: 'OPD',        href: '/opd',        icon: 'stethoscope'      },
    { label: 'IPD',        href: '/ipd',        icon: 'bed'              },
    { label: 'Lab',        href: '/lab',        icon: 'flask-conical'    },
    { label: 'Inventory',  href: '/inventory',  icon: 'package'          },
    { label: 'Payments',   href: '/payments',   icon: 'credit-card'      },
    { label: 'Audit Logs', href: '/audit',      icon: 'file-text'        },
  ],
  STAFF: [
    { label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' },
  ],
};

export function getNavItems(role: UserRole): NavItem[] {
  return NAV_MAP[role] ?? [];
}
