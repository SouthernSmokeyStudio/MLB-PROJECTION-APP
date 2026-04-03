<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Logger {
    public function __construct(private ?SSS_MLB_Run_Logs_Repository $logs = null) {}

    public function log(string $level, string $context_key, string $message, array $details = []): void {
        if ($this->logs) {
            $this->logs->insert($level, $context_key, $message, $details);
            return;
        }

        global $wpdb;
        $table = $wpdb->prefix . 'sss_mlb_run_logs';
        $wpdb->insert($table, [
            'log_level' => $level,
            'context_key' => $context_key,
            'message' => $message,
            'details' => !empty($details) ? wp_json_encode($details) : null,
            'created_at' => current_time('mysql', true),
        ], ['%s', '%s', '%s', '%s', '%s']);
    }

    public function info(string $context_key, string $message, array $details = []): void {
        $this->log('info', $context_key, $message, $details);
    }

    public function warning(string $context_key, string $message, array $details = []): void {
        $this->log('warning', $context_key, $message, $details);
    }

    public function error(string $context_key, string $message, array $details = []): void {
        $this->log('error', $context_key, $message, $details);
    }
}
