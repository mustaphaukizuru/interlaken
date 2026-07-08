export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'admin' | 'parent' | 'student' | 'staff';
  avatar: string;
  whatsapp: string;
}

export interface StudentProfile {
  id: number;
  user: User;
  student_id: string;
  grade: string;
  group: string;
  loyverse_id: string;
}

export interface CafeteriaBalance {
  id: number;
  student: StudentProfile;
  balance: string;
  low_balance_threshold: string;
  last_synced: string;
}

export interface CafeteriaTransactionItem {
  name: string;
  quantity: number | string;
  total: string | null;
}

export interface CafeteriaTransaction {
  id: number;
  student_id: number;
  transaction_type: 'purchase' | 'topup' | 'refund';
  amount: string;
  description: string;
  items: CafeteriaTransactionItem[];
  balance_after: string | null;
  date: string;
  loyverse_receipt_id: string;
}

export interface TopUpLogEntry {
  id: number;
  student_id: number;
  student_name: string;
  student_code: string;
  amount: string;
  method: 'online' | 'office';
  method_display: string;
  status: 'pending' | 'completed' | 'failed';
  status_display: string;
  gateway: string;
  payment_status: string;
  gateway_tx_id: string;
  created_at: string;
  processed_at: string | null;
}

export interface BalanceAdjustment {
  id: number;
  kind: 'adjustment' | 'refund';
  kind_display: string;
  amount: string;
  reason: string;
  balance_after: string | null;
  admin_name: string;
  transaction: number | null;
  source_transaction: number | null;
  created_at: string;
}

export interface ReconcileRow {
  student_id: number;
  student_name: string;
  student_code: string;
  loyverse_id: string;
  local_balance: string;
  loyverse_balance: string | null;
  drift: string | null;
  in_sync: boolean;
  error: string | null;
}

export interface CafeteriaStudentDetail {
  balance: CafeteriaBalance;
  parents: Array<{ id: number; full_name: string; email: string; whatsapp: string }>;
  transactions: CafeteriaTransaction[];
  adjustments: BalanceAdjustment[];
}

export interface Payment {
  id: number;
  payment_type: 'tuition' | 'enrollment' | 'cafeteria' | 'other';
  amount: string;
  currency: string;
  description: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'refunded';
  gateway_tx_id: string;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: 'all' | 'parents' | 'students' | 'staff';
  created_at: string;
}

export interface PreRegistrationData {
  child_name: string;
  child_dob: string;
  grade_applying: string;
  parent_name: string;
  email: string;
  phone: string;
  how_did_you_hear?: string;
  message?: string;
}

export interface OpenSchoolEvent {
  id: number;
  date: string;
  title: string;
  description: string;
  location: string;
  max_capacity: number;
  spots_remaining: number;
  is_active: boolean;
}

export interface AvailabilitySlot {
  id: number;
  visit_type: 'open_class' | 'individual';
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  location: string;
  spots_remaining: number;
  is_full: boolean;
}

export interface Booking {
  id: number;
  slot: number;
  visit_type: 'open_class' | 'individual';
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  slot_location: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string;
  child_name: string;
  child_grade: string;
  num_attendees: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'attended' | 'no_show';
  source: 'web' | 'whatsapp' | 'admin';
  confirmation_sent: boolean;
  created_at: string;
}

export interface DashboardData {
  children_count?: number;
  children?: Array<{ id: number; name: string; grade: string; group: string; student_id: string }>;
  cafeteria_balances?: Array<{ student_name: string; balance: string; low: boolean; last_synced: string }>;
  recent_payments?: Array<{ id: number; type: string; amount: string; status: string; date: string }>;
  student_id?: string;
  grade?: string;
  group?: string;
  cafeteria_balance?: string;
  is_low_balance?: boolean;
  total_students?: number;
  total_users?: number;
  pending_preregistrations?: number;
  pending_registrations?: number;
  pending_payments?: number;
  total_revenue?: string;
  announcements?: Announcement[];
  unread_notifications?: number;
}
