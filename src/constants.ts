import type { AppRole, AttendanceStatus, ClassType, EnrollmentStatus, PaymentStatus, TabId } from './types';

/** Fallback weekly teaching-hour target when no value is set in Pengaturan. */
export const WEEKLY_HOUR_TARGET = 10;

export const CLASS_TYPES: ClassType[] = [
  'Private',
  'Semi-Private',
  'Group',
  'Kids Private',
  'Kids Semi Private'
];

export const PAYMENT_STATUSES: PaymentStatus[] = ['LUNAS', 'CICILAN', 'BELUM_BAYAR'];

export const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'ending_soon', 'completed', 'stopped'];

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  active: 'ACTIVE',
  ending_soon: 'ENDING SOON',
  completed: 'COMPLETED',
  stopped: 'STOPPED',
  transferred: 'TRANSFERRED',
  cancelled: 'CANCELLED'
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  LUNAS: 'Lunas',
  CICILAN: 'Cicilan',
  BELUM_BAYAR: 'Belum bayar'
};

export const CLASS_LEVELS = [
  'Intensif Pra Guntai',
  'Intensif N5',
  'Intensif N4',
  'Intensif N3',
  'Intensif N2',
  'Pra Guntai',
  'Guntai 1',
  'Guntai 2',
  'Guntai 3',
  'Guntai 4',
  'Guntai 5',
  'Guntai 6',
  'Guntai 7',
  'Guntai 8',
  'Guntai 9',
  'Guntai 10',
  'Daimyou 1',
  'Daimyou 2',
  'Daimyou 3',
  'Daimyou 4',
  'Daimyou 5',
  'Daimyou 6',
  'Shogun 1',
  'Shogun 2',
  'Shogun 3',
  'Shogun 4',
  'Shogun 5',
  'Shogun 6',
  'Shogun 7',
  'Shogun 8',
  'N5',
  'N4',
  'N3',
  'N2',
  'Custom N5',
  'Custom N4',
  'Custom N3',
  'Custom Kaiwa',
  'Custom Intensif N5',
  'Custom Intensif N4',
  'Irodori',
  ...Array.from({ length: 18 }, (_, index) => `Level ${index} Kids`)
];

export const CLASS_MASTER_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready to Start' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' }
] as const;

export const DAYS_OF_WEEK = [
  { label: 'Senin', value: 1 },
  { label: 'Selasa', value: 2 },
  { label: 'Rabu', value: 3 },
  { label: 'Kamis', value: 4 },
  { label: 'Jumat', value: 5 },
  { label: 'Sabtu', value: 6 },
  { label: 'Minggu', value: 0 }
];

export const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'Present', label: 'Hadir' },
  { value: 'Late', label: 'Terlambat' },
  { value: 'Excused', label: 'Izin' },
  { value: 'Absent', label: 'Alpa' },
  { value: 'Partial', label: 'Parsial' }
];

export const TIME_SLOTS = Array.from({ length: 15 }, (_, index) => {
  const hour = index + 7;
  return `${String(hour).padStart(2, '0')}:00`;
});

export const ROLE_COPY: Record<AppRole, { title: string; subtitle: string }> = {
  'Super Admin': {
    title: 'Super Admin / Ops',
    subtitle: 'Kendali penuh jadwal resmi, override, dan pengguna'
  },
  Kyouiku: {
    title: 'Kyouiku / Head Sensei',
    subtitle: 'QA mengajar, rekaman, dan pengawasan akademik'
  },
  Sensei: {
    title: 'Sensei',
    subtitle: 'Ketersediaan, sesi mengajar, dan laporan kelas sendiri'
  }
};

export const NAV_BY_ROLE: Record<AppRole, TabId[]> = {
  'Super Admin': [
    'overview',
    'classes',
    'schedule',
    'availability',
    'teaching',
    'sensei',
    'students',
    'qa',
    'disciplinary',
    'reports',
    'audit',
    'users',
    'settings'
  ],
  Kyouiku: [
    'overview',
    'classes',
    'schedule',
    'availability',
    'teaching',
    'sensei',
    'students',
    'qa',
    'disciplinary',
    'reports',
    'audit'
  ],
  Sensei: [
    'overview',
    'classes',
    'schedule',
    'availability',
    'teaching',
    'students',
    'qa',
    'disciplinary',
    'reports'
  ]
};

export const TAB_LABELS: Record<TabId, string> = {
  overview: 'Action Center',
  classes: 'Class Master',
  schedule: 'Jadwal Resmi',
  availability: 'Ketersediaan',
  teaching: 'Sesi Mengajar',
  sensei: 'Sensei',
  students: 'Akademik Siswa',
  qa: 'QA & Rekaman',
  disciplinary: 'Disiplin',
  reports: 'Laporan EOM',
  audit: 'Audit Log',
  users: 'Pengguna',
  settings: 'Pengaturan'
};
