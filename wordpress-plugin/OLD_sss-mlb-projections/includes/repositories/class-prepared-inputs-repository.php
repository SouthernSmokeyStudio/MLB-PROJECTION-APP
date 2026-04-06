<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Prepared_Inputs_Repository extends SSS_MLB_Base_Repository {
    public function get_feature_set_id(string $feature_set_key): int {
        return (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$this->table('feature_sets')} WHERE feature_set_key = %s LIMIT 1",
            $feature_set_key
        ));
    }

    public function get_latest_valid_for_event(int $event_id, string $subject_type = 'event'): ?array {
        $sql = $this->wpdb->prepare(
            "SELECT * FROM {$this->table('prepared_inputs')}
             WHERE event_id = %d
               AND subject_type = %s
               AND validation_status = 'valid'
             ORDER BY prepared_at_utc DESC, id DESC
             LIMIT 1",
            $event_id,
            $subject_type
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function get_player_opportunity_inputs_for_event(int $event_id): array {
        $prepared_inputs = $this->table('prepared_inputs');
        $feature_sets = $this->table('feature_sets');

        $sql = $this->wpdb->prepare(
            "SELECT pi.*, fs.feature_set_key
             FROM {$prepared_inputs} pi
             INNER JOIN {$feature_sets} fs ON fs.id = pi.feature_set_id
             WHERE pi.event_id = %d
               AND pi.subject_type = 'player'
               AND fs.feature_set_key IN ('phase1_hitter_opportunity', 'phase1_pitcher_opportunity')
             ORDER BY pi.id ASC",
            $event_id
        );

        return $this->wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    public function upsert_validation_game_input(array $payload): int {
        $table = $this->table('prepared_inputs');
        $existing_id = (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$table} WHERE prepared_input_key = %s LIMIT 1",
            $payload['prepared_input_key']
        ));

        if ($existing_id > 0) {
            $result = $this->wpdb->update($table, $payload, ['id' => $existing_id]);

            if ($result === false) {
                throw new RuntimeException('Failed to update prepared input: ' . $this->wpdb->last_error);
            }

            return $existing_id;
        }

        $result = $this->wpdb->insert($table, $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert prepared input: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }
}
