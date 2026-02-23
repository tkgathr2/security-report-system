export type Screen = 'dashboard' | 'csv' | 'projects' | 'reports' | 'staff' | 'import_history' | 'clients' | 'cast_users' | 'accounts' | 'send_url' | 'inquiries'

export interface AdminUser {
  id: string
  email: string
  role: string
}

export interface AccessRequest {
  id: string
  email: string
  display_name: string | null
  status: string
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
}

export interface AdminAccount {
  id: string
  email: string
  is_active: boolean
  role: string
  created_at: string
}

export interface ProjectCast {
  staff_no: string
  cast_name: string
}

export interface Project {
  id: string
  project_key: string
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
  status: string
  unique_url: string
  url_expires_at: string
  created_at: string
  client_name: string | null
  casts?: ProjectCast[]
}

export interface Report {
  id: string
  project_id: string
  supervisor_name: string
  writer_name: string
  weather: string
  status: string
  approved_at: string
  created_at: string
  pdf_generation_status: string
  pdf_size: number
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
}

export interface ReportDetail {
  id: string
  project_id: string
  supervisor_name: string
  writer_name: string
  weather: string
  guard_contents: string[]
  guard_other_text: string | null
  has_qualifier: boolean
  qualifier_name: string | null
  guards_json: string | null
  status: string
  approved_at: string
  created_at: string
  pdf_generation_status: string
  pdf_size: number
  signature_png_base64: string | null
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
  work_title_raw: string
}

export interface StaffMember {
  id: string
  display_name_kanji: string
  display_name_kana: string
  email: string | null
  registered_email: string | null
  cast_user_id: string | null
  created_at: string
  updated_at: string
}

export interface ImportResult {
  ok: boolean
  status: string
  blocked?: boolean
  blocked_reason?: string
  message?: string
  created_projects_count: number
  existing_projects_count: number
  updated_projects_count: number
  skipped_rows_count: number
  pending_client_rows_count: number
  staff_auto_added_count: number
  duplicate_cast_assignments: number
  staff_without_email: string[]
  errors: Array<{ row: number; reason: string }>
}

export interface DashboardStats {
  total_projects: number
  active_projects: number
  total_reports: number
  pending_reports: number
  total_staff: number
  today_projects: number
  today_reported: number
}

export interface CsvImportHistory {
  id: string
  imported_by_admin_email: string
  original_file_name: string
  detected_encoding: string
  status: string
  created_projects_count: number
  skipped_rows_count: number
  pending_client_rows_count: number
  errors_json: string
  created_at: string
}

export interface Client {
  id: string
  name: string
  name_normalized: string
  emails: string[]
  is_active: boolean
  contact_name: string | null
  contact_title: string | null
  contact_email: string | null
  address: string | null
  created_at: string
  updated_at: string
}
