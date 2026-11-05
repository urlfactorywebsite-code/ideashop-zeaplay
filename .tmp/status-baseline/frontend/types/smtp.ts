export type SmtpProvider = 'custom' | 'gmail' | 'outlook_com' | 'microsoft365' | 'zoho' | 'mailgun' | 'sendgrid';
export type MailCategory = 'general' | 'notifications' | 'otp' | 'rewards' | 'system_alerts' | 'task_updates' | 'welcome';
export interface SmtpProfileInput {
    name: string; provider: SmtpProvider; host: string; port: number; username: string;
    password?: string; encryption: 'tls' | 'ssl' | 'none'; priority: number; is_enabled: boolean;
    auth_method: 'password' | 'oauth2' | 'none'; sender_name: string | null;
    sender_email: string | null; reply_to: string | null; rate_limit_per_minute: number;
    daily_limit: number; notification_types: MailCategory[];
}
export interface SmtpProfile extends Omit<SmtpProfileInput, 'password'> {
    id: string; has_password: boolean; secret_encrypted: boolean;
    health: 'healthy' | 'degraded' | 'unhealthy' | 'untested' | 'disabled';
    last_test_at: string | null; last_test_code: string | null; last_test_ok: boolean | null;
    created_at: string; updated_at: string;
}
export interface SmtpAttemptStats {
    smtp_accepted: number; failed_attempts: number; uncertain_attempts: number;
    success_percentage: number | null; average_processing_ms: number | null; attempts_last_minute: number;
}
export interface SmtpHealth extends SmtpAttemptStats {
    window_hours: number; window_start: string; as_of: string;
    profiles: number; enabled_profiles: number; healthy_profiles: number;
    queue: Record<'queued' | 'sending' | 'retrying' | 'sent' | 'failed' | 'uncertain', number>;
    profile_stats: Record<string, SmtpAttemptStats>; retired_profile_keys: string[]; definitions: Record<string, string>;
}
export interface SmtpJob {
    id: string; category: string; state: string; attempts: number; max_attempts: number;
    next_attempt_at: string | null; created_at: string; can_retry: boolean;
}
export interface SmtpAttempt {
    id: string; profile_key: string; outbox_id: string | null; category: string;
    kind: string; outcome: string; code: string | null; started_at: string; finished_at: string | null;
}
