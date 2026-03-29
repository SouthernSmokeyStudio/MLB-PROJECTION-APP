<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Projections_Repository extends SSS_MLB_Base_Repository {
    public function insert_formula_run(array $payload): int {
        $this->wpdb->insert($this->table('formula_runs'), $payload);
        return (int) $this->wpdb->insert_id;
    }

    public function insert_projection(array $payload): int {
        $this->wpdb->insert($this->table('projections'), $payload);
        return (int) $this->wpdb->insert_id;
    }

    public function insert_release_audit(array $payload): int {
        $this->wpdb->insert($this->table('release_audits'), $payload);
        return (int) $this->wpdb->insert_id;
    }

    public function get_published_slate(string $date_ymd): array {
        $start = $date_ymd . ' 00:00:00';
        $end = $date_ymd . ' 23:59:59';

        $sql = $this->wpdb->prepare(
            "SELECT p.*, e.event_label, e.scheduled_start_utc
             FROM {$this->table('projections')} p
             INNER JOIN {$this->table('events')} e ON e.id = p.event_id
             WHERE p.release_decision = 'publish'
               AND e.scheduled_start_utc BETWEEN %s AND %s
             ORDER BY e.scheduled_start_utc ASC, p.output_family ASC, p.output_label ASC",
            $start,
            $end
        );

        return $this->wpdb->get_results($sql, ARRAY_A) ?: [];
    }
}
