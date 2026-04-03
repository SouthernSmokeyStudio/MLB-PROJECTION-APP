<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Projections_Repository extends SSS_MLB_Base_Repository {
    public function insert_formula_run(array $payload): int {
        $result = $this->wpdb->insert($this->table('formula_runs'), $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert formula run: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }

    public function insert_projection(array $payload): int {
        $result = $this->wpdb->insert($this->table('projections'), $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert projection: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }

    public function insert_release_audit(array $payload): int {
        $result = $this->wpdb->insert($this->table('release_audits'), $payload);

        if ($result === false || (int) $this->wpdb->insert_id <= 0) {
            throw new RuntimeException('Failed to insert release audit: ' . $this->wpdb->last_error);
        }

        return (int) $this->wpdb->insert_id;
    }

    public function get_published_slate(string $date_ymd): array {
        $start = $date_ymd . ' 00:00:00';
        $end = $date_ymd . ' 23:59:59';

        $sql = $this->wpdb->prepare(
            "SELECT p.*, e.event_label, e.scheduled_start_utc, pi.subject_id AS player_id
             FROM {$this->table('projections')} p
             INNER JOIN {$this->table('events')} e ON e.id = p.event_id
             LEFT JOIN {$this->table('prepared_inputs')} pi ON pi.id = p.prepared_input_id
             WHERE p.release_decision = 'publish'
               AND e.scheduled_start_utc BETWEEN %s AND %s
             ORDER BY e.scheduled_start_utc ASC, p.output_family ASC, p.output_label ASC",
            $start,
            $end
        );

        return $this->wpdb->get_results($sql, ARRAY_A) ?: [];
    }

    public function get_publish_safe_slate(string $date_ymd): array {
        $rows = $this->get_published_slate($date_ymd);
        $events = [];

        foreach ($rows as $row) {
            $event_id = (int) $row['event_id'];

            if (!isset($events[$event_id])) {
                $events[$event_id] = [
                    'event_id' => $event_id,
                    'event_label' => $row['event_label'],
                    'scheduled_start_utc' => $row['scheduled_start_utc'],
                    'game_projections' => [],
                    'player_opportunity' => [],
                    'core_markets' => [],
                ];
            }

            $projection = [
                'projection_key' => $row['projection_key'],
                'output_label' => $row['output_label'],
                'point_estimate' => $row['point_estimate'],
                'fair_probability' => $row['fair_probability'],
                'fair_odds_american' => $row['fair_odds_american'],
                'fair_line' => $row['fair_line'],
                'distribution_payload' => $row['distribution_payload'],
                'prepared_input_id' => $row['prepared_input_id'],
                'player_id' => $row['player_id'],
            ];

            if ($row['output_family'] === 'game_projection') {
                $events[$event_id]['game_projections'][] = $projection;
                continue;
            }

            if ($row['output_family'] === 'player_opportunity') {
                $events[$event_id]['player_opportunity'][] = $projection;
                continue;
            }

            if ($row['output_family'] === 'betting_projection') {
                $events[$event_id]['core_markets'][] = $projection;
            }
        }

        return [
            'date' => $date_ymd,
            'events' => array_values($events),
        ];
    }
}
