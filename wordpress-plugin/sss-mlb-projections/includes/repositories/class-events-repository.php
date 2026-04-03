<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Events_Repository extends SSS_MLB_Base_Repository {
    public function get_upcoming_events(int $limit = 50): array {
        $now = current_time('mysql', true);
        $sql = $this->wpdb->prepare(
            "SELECT * FROM {$this->table('events')} WHERE scheduled_start_utc >= %s ORDER BY scheduled_start_utc ASC LIMIT %d",
            $now,
            $limit
        );
        return $this->wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    public function get_event(int $event_id): ?array {
        $row = $this->wpdb->get_row(
            $this->wpdb->prepare("SELECT * FROM {$this->table('events')} WHERE id = %d", $event_id),
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }

    public function upsert_demo_event(array $event): int {
        $table = $this->table('events');
        $existing_id = (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$table} WHERE event_key = %s",
            $event['event_key']
        ));

        if ($existing_id > 0) {
            $result = $this->wpdb->update($table, $event, ['id' => $existing_id]);

            if ($result === false) {
                throw new RuntimeException('Failed to update validation demo event: ' . $this->wpdb->last_error);
            }

            return $existing_id;
        }

        $result = $this->wpdb->insert($table, $event);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert validation demo event: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }
}
