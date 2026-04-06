<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Markets_Repository extends SSS_MLB_Base_Repository {
    public function get_provider_id_by_key(string $provider_key): int {
        return (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$this->table('providers')} WHERE provider_key = %s LIMIT 1",
            $provider_key
        ));
    }

    public function get_market_type_id_by_key(string $market_type_key): int {
        return (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$this->table('market_types')} WHERE market_type_key = %s LIMIT 1",
            $market_type_key
        ));
    }

    public function get_market_types(): array {
        return $this->wpdb->get_results(
            "SELECT * FROM {$this->table('market_types')} WHERE is_active = 1 ORDER BY id ASC",
            ARRAY_A
        ) ?: [];
    }

    public function get_event_markets(int $event_id): array {
        $sql = $this->wpdb->prepare(
            "SELECT mi.*, mt.market_type_key
             FROM {$this->table('market_instances')} mi
             INNER JOIN {$this->table('market_types')} mt ON mt.id = mi.market_type_id
             WHERE mi.event_id = %d
             ORDER BY mi.id ASC",
            $event_id
        );
        return $this->wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    public function get_latest_odds_for_selection(int $selection_id): ?array {
        $sql = $this->wpdb->prepare(
            "SELECT * FROM {$this->table('odds_snapshots')}
             WHERE selection_id = %d
             ORDER BY captured_at_utc DESC, id DESC
             LIMIT 1",
            $selection_id
        );
        $row = $this->wpdb->get_row($sql, ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function get_market_type_by_key(string $market_type_key): ?array {
        $sql = $this->wpdb->prepare(
            "SELECT mt.*, sr.id AS settlement_rule_id
             FROM {$this->table('market_types')} mt
             LEFT JOIN {$this->table('settlement_rules')} sr
               ON sr.settlement_rule_key = mt.settlement_rule_key
              AND sr.is_active = 1
             WHERE mt.market_type_key = %s
               AND mt.is_active = 1
             LIMIT 1",
            $market_type_key
        );

        $row = $this->wpdb->get_row($sql, ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function is_supported_market_type_key(?string $market_type_key): bool {
        if ($market_type_key === null || $market_type_key === '') {
            return false;
        }

        $market_type = $this->get_market_type_by_key($market_type_key);
        return is_array($market_type) && ($market_type['support_tier'] ?? null) === 'production';
    }

    public function market_type_has_settlement_rule(?string $market_type_key): bool {
        if ($market_type_key === null || $market_type_key === '') {
            return false;
        }

        $market_type = $this->get_market_type_by_key($market_type_key);
        return is_array($market_type) && !empty($market_type['settlement_rule_key']) && !empty($market_type['settlement_rule_id']);
    }

    public function upsert_market_instance(array $payload): int {
        $table = $this->table('market_instances');
        $existing_id = (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$table}
             WHERE provider_id = %d AND provider_market_id = %s
             LIMIT 1",
            $payload['provider_id'],
            $payload['provider_market_id']
        ));

        if ($existing_id > 0) {
            $result = $this->wpdb->update($table, $payload, ['id' => $existing_id]);

            if ($result === false) {
                throw new RuntimeException('Failed to update market instance: ' . $this->wpdb->last_error);
            }

            return $existing_id;
        }

        $result = $this->wpdb->insert($table, $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert market instance: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }

    public function upsert_selection(array $payload): int {
        $table = $this->table('selections');
        $existing_id = (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$table}
             WHERE market_instance_id = %d
               AND selection_role = %s
               AND selection_label = %s
             LIMIT 1",
            $payload['market_instance_id'],
            $payload['selection_role'],
            $payload['selection_label']
        ));

        if ($existing_id > 0) {
            $result = $this->wpdb->update($table, $payload, ['id' => $existing_id]);

            if ($result === false) {
                throw new RuntimeException('Failed to update selection: ' . $this->wpdb->last_error);
            }

            return $existing_id;
        }

        $result = $this->wpdb->insert($table, $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert selection: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }

    public function insert_odds_snapshot_if_missing(array $payload): int {
        $table = $this->table('odds_snapshots');
        $existing_id = (int) $this->wpdb->get_var($this->wpdb->prepare(
            "SELECT id FROM {$table}
             WHERE market_instance_id = %d
               AND selection_id = %d
               AND source_payload_hash = %s
             ORDER BY id DESC
             LIMIT 1",
            $payload['market_instance_id'],
            $payload['selection_id'],
            $payload['source_payload_hash']
        ));

        if ($existing_id > 0) {
            return $existing_id;
        }

        $result = $this->wpdb->insert($table, $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert odds snapshot: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }
}
