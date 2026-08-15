export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'admin' | 'parent' | 'student' | 'staff';
  avatar: string;
  whatsapp: string;
  has_usable_password?: boolean;
  notif_prefs?: {
    email_enabled: boolean;
    in_app_enabled: boolean;
    push_enabled: boolean;
  };
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
  /** Backend uses balance <= threshold; prefer this over recomputing. */
  is_low_balance?: boolean;
  /** Parent-set spend caps (F13). "0.00" disables the cap. */
  daily_spend_limit?: string;
  weekly_spend_limit?: string;
  /** Running spend for budget progress (family views only; null otherwise). */
  today_spend?: string | null;
  week_spend?: string | null;
}

export interface CafeteriaTransactionItem {
  name: string;
  quantity: number | string;
  total: string | null;
  category?: string;
}

/** Loyverse customer snapshot (visits, lifetime spend, points). */
export interface LoyverseProfile {
  customer_code: string;
  name: string;
  email: string;
  address_code: string;
  first_visit: string | null;
  last_visit: string | null;
  total_visits: number;
  total_spent: string;
  total_points: string;
  synced_at: string;
}

/** Digital cafetería card for one child (from /cafeteria/cards/). */
export interface CafeteriaCard {
  student: { id: number; name: string; grade: string; group: string; student_id: string };
  code: string;            // matrícula the POS scans (QR/barcode payload)
  linked: boolean;
  balance: string;
  is_low_balance: boolean;
  points: string | null;
  loyverse: LoyverseProfile | null;
}

/** Read-only recent purchase pulled live from Loyverse. */
export interface LoyverseHistoryReceipt {
  receipt_number: string | null;
  date: string | null;
  type: 'purchase' | 'refund';
  amount: string;
  description: string;
  items: CafeteriaTransactionItem[];
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
  pos_loaded_at: string | null;
  pos_loaded_by_name: string;
  needs_pos_load: boolean;
  pos_unload_needed_at: string | null;
  pos_unloaded_at: string | null;
  pos_unloaded_by_name: string;
  needs_pos_unload: boolean;
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

export interface LoyverseProfile {
  customer_code: string;
  name: string;
  email: string;
  phone_number: string;
  address_code: string;
  note: string;
  first_visit: string | null;
  last_visit: string | null;
  total_visits: number;
  total_spent: string;
  total_points: string;
  loyverse_created_at: string | null;
  synced_at: string;
}

export interface CafeteriaStudentDetail {
  balance: CafeteriaBalance;
  parents: Array<{ id: number; full_name: string; email: string; whatsapp: string }>;
  transactions: CafeteriaTransaction[];
  adjustments: BalanceAdjustment[];
  /** Full Loyverse customer snapshot; null when never synced. */
  loyverse: LoyverseProfile | null;
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

// (Finance/tuition types removed: the app does not bill tuition.)

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
  /** True when the family account has no linked StudentProfile yet. */
  needs_family_link?: boolean;
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

/** One append-only audit-trail row (core.AuditLog). */
export interface AuditLogEntry {
  id: number;
  actor: number | null;
  actor_label: string;
  action: 'create' | 'update' | 'delete' | 'permission';
  action_display: string;
  object_type: string;
  object_id: string;
  changes: Record<string, unknown>;
  context: string;
  created_at: string;
}
