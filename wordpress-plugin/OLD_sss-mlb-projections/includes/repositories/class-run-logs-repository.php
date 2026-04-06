<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Run_Logs_Repository extends SSS_MLB_Base_Repository {
    public function insert(string $level, string $context_key, string $message, array $details = []): int {
        $this->wpdb->insert($this->table('run_logs'), [
            'log_level' => $level,
            'context_key' => $context_key,
            'message' => $message,
            'details' => !empty($details) ? wp_json_encode($details) : null,
            'created_at' => current_time('mysql', true),
        ], ['%s', '%s', '%s', '%s', '%s']);

        return (int) $this->wpdb->insert_id;
    }
}
