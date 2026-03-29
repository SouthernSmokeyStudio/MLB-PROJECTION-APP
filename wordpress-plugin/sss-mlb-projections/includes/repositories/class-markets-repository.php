<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Markets_Repository extends SSS_MLB_Base_Repository {
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
}
