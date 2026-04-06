<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_System_State_Repository extends SSS_MLB_Base_Repository {
    public function get(string $state_key): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table('system_state')} WHERE state_key = %s LIMIT 1", $state_key),
            ARRAY_A
        );

        return is_array($row) ? $row : null;
    }

    public function get_value(string $state_key, mixed $default = null): mixed {
        $row = $this->get($state_key);
        if (!$row) {
            return $default;
        }

        $decoded = json_decode((string) $row['state_value'], true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $row['state_value'];
    }

    public function set(string $state_key, mixed $value): void {
        $serialized = is_string($value) ? $value : wp_json_encode($value);
        if ($serialized === false) {
            throw new RuntimeException('Failed to encode system_state value for key ' . $state_key);
        }

        $result = $this->wpdb->replace($this->table('system_state'), [
            'state_key' => $state_key,
            'state_value' => $serialized,
            'updated_at' => current_time('mysql', true),
        ], ['%s', '%s', '%s']);

        if ($result === false) {
            throw new RuntimeException('Failed to write system_state key ' . $state_key . ': ' . $this->wpdb->last_error);
        }
    }

    public function append_event(string $state_key, array $event, int $max_items = 20): void {
        $current = $this->get_value($state_key, []);
        $history = is_array($current) ? $current : [];
        $history[] = $event;

        if (count($history) > $max_items) {
            $history = array_slice($history, -$max_items);
        }

        $this->set($state_key, array_values($history));
    }
}
