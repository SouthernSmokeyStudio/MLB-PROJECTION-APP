<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Job_Locks_Repository extends SSS_MLB_Base_Repository {
    public function claim(string $job_key, string $runner_id, int $ttl_seconds = 840): bool {
        $table = $this->table('job_locks');
        $now = current_time('mysql', true);
        $expires = gmdate('Y-m-d H:i:s', time() + $ttl_seconds);

        $existing = $this->wpdb->get_row($this->wpdb->prepare(
            "SELECT * FROM {$table} WHERE job_key = %s LIMIT 1",
            $job_key
        ), ARRAY_A);

        if (
            $existing
            && ($existing['status'] ?? '') === 'running'
            && strtotime((string) $existing['expires_at_utc']) > time()
        ) {
            return false;
        }

        if ($existing) {
            $this->wpdb->update($table, [
                'runner_id' => $runner_id,
                'locked_at_utc' => $now,
                'expires_at_utc' => $expires,
                'heartbeat_at_utc' => $now,
                'status' => 'running',
                'updated_at' => $now,
            ], ['job_key' => $job_key]);
            return true;
        }

        $this->wpdb->insert($table, [
            'job_key' => $job_key,
            'runner_id' => $runner_id,
            'locked_at_utc' => $now,
            'expires_at_utc' => $expires,
            'heartbeat_at_utc' => $now,
            'status' => 'running',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return true;
    }

    public function release(string $job_key): void {
        $now = current_time('mysql', true);
        $this->wpdb->update($this->table('job_locks'), [
            'status' => 'completed',
            'heartbeat_at_utc' => $now,
            'expires_at_utc' => $now,
            'updated_at' => $now,
        ], ['job_key' => $job_key]);
    }

    public function heartbeat(string $job_key, int $ttl_seconds = 840): void {
        $now = current_time('mysql', true);
        $expires = gmdate('Y-m-d H:i:s', time() + $ttl_seconds);

        $this->wpdb->update($this->table('job_locks'), [
            'heartbeat_at_utc' => $now,
            'expires_at_utc' => $expires,
            'updated_at' => $now,
        ], ['job_key' => $job_key]);
    }

    public function mark_failed(string $job_key): void {
        $now = current_time('mysql', true);
        $this->wpdb->update($this->table('job_locks'), [
            'status' => 'failed',
            'heartbeat_at_utc' => $now,
            'expires_at_utc' => $now,
            'updated_at' => $now,
        ], ['job_key' => $job_key]);
    }
}
