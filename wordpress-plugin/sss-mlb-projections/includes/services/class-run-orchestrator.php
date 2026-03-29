<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Run_Orchestrator {
    public function __construct(
        private SSS_MLB_Job_Locks_Repository $locks,
        private SSS_MLB_Formula_Registry_Repository $formula_registry,
        private SSS_MLB_Events_Repository $events,
        private SSS_MLB_Markets_Repository $markets,
        private SSS_MLB_Projections_Repository $projections,
        private SSS_MLB_Feature_Builder $feature_builder,
        private SSS_MLB_Formula_F001 $formula_f001,
        private SSS_MLB_Formula_F002 $formula_f002,
        private SSS_MLB_Formula_F003 $formula_f003,
        private SSS_MLB_Formula_F004 $formula_f004,
        private SSS_MLB_Formula_F005 $formula_f005,
        private SSS_MLB_Formula_F007 $formula_f007,
        private SSS_MLB_Release_Manager $release_manager,
        private SSS_MLB_Logger $logger
    ) {}

    public function ingest_core_markets(): void {
        $job_key = 'phase1_ingest_core_markets';
        $runner_id = wp_generate_uuid4();

        if (!$this->locks->claim($job_key, $runner_id, 240)) {
            $this->logger->warning($job_key, 'Ingest skipped because another runner owns the lock.');
            return;
        }

        $this->logger->info($job_key, 'Phase 1 ingest placeholder executed.');
        $this->locks->release($job_key);
    }

    public function archive_results(): void {
        $job_key = 'phase1_archive_results';
        $runner_id = wp_generate_uuid4();

        if (!$this->locks->claim($job_key, $runner_id, 240)) {
            $this->logger->warning($job_key, 'Results archive skipped because another runner owns the lock.');
            return;
        }

        $this->logger->info($job_key, 'Phase 1 results archive placeholder executed.');
        $this->locks->release($job_key);
    }

    public function run_full_projection_batch(): void {
        $job_key = 'phase1_full_projection_batch';
        $runner_id = wp_generate_uuid4();

        if (!$this->locks->claim($job_key, $runner_id, 840)) {
            $this->logger->warning($job_key, 'Projection batch skipped because another runner owns the lock.');
            return;
        }

        try {
            $events = $this->events->get_upcoming_events(25);

            foreach ($events as $event) {
                $this->run_event_projection_pipeline($event);
            }

            $this->logger->info($job_key, 'Projection batch finished.', ['event_count' => count($events)]);
        } catch (Throwable $throwable) {
            $this->logger->error($job_key, 'Projection batch failed.', [
                'error' => $throwable->getMessage(),
            ]);
        } finally {
            $this->locks->release($job_key);
        }
    }

    private function run_event_projection_pipeline(array $event): void {
        $features = $this->feature_builder->build_game_features($event);
        $f001_version = $this->formula_registry->get_approved_version('F001');

        if (!$f001_version) {
            $this->logger->error('phase1_event_' . $event['id'], 'Missing approved F001 version.');
            return;
        }

        $run_id = $this->projections->insert_formula_run([
            'run_key' => 'run_' . wp_generate_uuid4(),
            'formula_version_id' => $f001_version['id'],
            'run_type' => 'live_publish',
            'run_status' => 'completed',
            'triggered_at_utc' => current_time('mysql', true),
            'completed_at_utc' => current_time('mysql', true),
            'code_ref' => 'plugin:0.1.0',
            'config_hash' => md5('phase1-core'),
            'notes' => 'Phase 1 core batch',
            'created_at' => current_time('mysql', true),
        ]);

        $f001 = $this->formula_f001->run($features);
        $f002 = $this->formula_f002->run($f001);
        $f003 = $this->formula_f003->run($f001);
        $f004 = $this->formula_f004->run($f001);

        $release = $this->release_manager->evaluate([
            'formula_version_key' => $f001_version['version_key'],
            'event_id' => (int) $event['id'],
            'data_quality_score' => $f001['data_quality_score'],
            'stability_score' => $f001['stability_score'],
            'stale_minutes' => 5,
            'starter_confirmed' => ($features['starter_confirmed_home'] ?? false) && ($features['starter_confirmed_away'] ?? false),
        ]);

        $created_projection_ids = [];
        $projection_rows = [
            [
                'output_family' => 'game_projection',
                'output_label' => 'home_win_probability',
                'fair_probability' => $f001['p_home_win'],
                'point_estimate' => null,
                'distribution_payload' => null,
            ],
            [
                'output_family' => 'game_projection',
                'output_label' => 'away_win_probability',
                'fair_probability' => $f001['p_away_win'],
                'point_estimate' => null,
                'distribution_payload' => null,
            ],
            [
                'output_family' => 'game_projection',
                'output_label' => 'home_team_runs',
                'fair_probability' => null,
                'point_estimate' => $f001['mu_home_runs'],
                'distribution_payload' => null,
            ],
            [
                'output_family' => 'game_projection',
                'output_label' => 'away_team_runs',
                'fair_probability' => null,
                'point_estimate' => $f001['mu_away_runs'],
                'distribution_payload' => null,
            ],
            [
                'output_family' => 'betting_projection',
                'output_label' => 'run_line_home_minus_1_5',
                'fair_probability' => $f002['run_line_home_minus_1_5_prob'],
                'point_estimate' => null,
                'distribution_payload' => wp_json_encode($f002['distribution_payload']),
            ],
            [
                'output_family' => 'betting_projection',
                'output_label' => 'total_over_8_5',
                'fair_probability' => $f003['total_over_8_5_prob'],
                'point_estimate' => $f003['mean_total_runs'],
                'distribution_payload' => wp_json_encode($f003['distribution_payload']),
            ],
            [
                'output_family' => 'betting_projection',
                'output_label' => 'home_team_total_over_4_5',
                'fair_probability' => $f004['home_team_over_4_5_prob'],
                'point_estimate' => $f004['home_team_total_mean'],
                'distribution_payload' => null,
            ],
            [
                'output_family' => 'betting_projection',
                'output_label' => 'away_team_total_over_4_5',
                'fair_probability' => $f004['away_team_over_4_5_prob'],
                'point_estimate' => $f004['away_team_total_mean'],
                'distribution_payload' => null,
            ],
        ];

        foreach ($projection_rows as $row) {
            $projection_id = $this->projections->insert_projection([
                'projection_key' => 'proj_' . wp_generate_uuid4(),
                'formula_run_id' => $run_id,
                'formula_version_id' => $f001_version['id'],
                'event_id' => (int) $event['id'],
                'market_instance_id' => null,
                'selection_id' => null,
                'prepared_input_id' => null,
                'projected_at_utc' => current_time('mysql', true),
                'output_family' => $row['output_family'],
                'output_label' => $row['output_label'],
                'fair_probability' => $row['fair_probability'],
                'fair_odds_american' => $this->probability_to_american($row['fair_probability']),
                'fair_odds_decimal' => $row['fair_probability'] ? round(1 / max(0.0001, $row['fair_probability']), 6) : null,
                'fair_line' => null,
                'point_estimate' => $row['point_estimate'],
                'distribution_payload' => $row['distribution_payload'],
                'confidence_band' => 'provisional',
                'stability_score' => $f001['stability_score'],
                'data_quality_score' => $f001['data_quality_score'],
                'release_decision' => $release['release_decision'],
                'release_reason' => empty($release['failure_codes']) ? null : implode(',', $release['failure_codes']),
                'top_drivers' => wp_json_encode([
                    'home_field_effect' => $features['home_field_effect'] ?? null,
                    'home_offense' => $features['home_offense'] ?? null,
                    'away_offense' => $features['away_offense'] ?? null,
                ]),
                'omissions' => wp_json_encode([
                    'lineups' => 'Phase 1 can publish before confirmed lineups for game-level projections only.',
                    'player_props' => 'Not supported in Phase 1.',
                ]),
                'created_at' => current_time('mysql', true),
            ]);
            $created_projection_ids[] = $projection_id;
        }

        foreach ($created_projection_ids as $projection_id) {
            $this->projections->insert_release_audit([
                'projection_id' => $projection_id,
                'release_rule_id' => (int) $release['release_rule_id'],
                'audit_time_utc' => current_time('mysql', true),
                'passed' => $release['passed'] ? 1 : 0,
                'failure_codes' => wp_json_encode($release['failure_codes']),
                'notes' => $release['passed'] ? 'Published by Phase 1 release filter.' : 'Blocked by Phase 1 release filter.',
                'created_at' => current_time('mysql', true),
            ]);
        }

        $this->logger->info('phase1_event_' . $event['id'], 'Phase 1 event projection completed.', [
            'event_id' => $event['id'],
            'released' => $release['release_decision'],
        ]);
    }

    private function probability_to_american(?float $probability): ?int {
        if ($probability === null || $probability <= 0 || $probability >= 1) {
            return null;
        }

        if ($probability >= 0.5) {
            return (int) round(-100 * $probability / (1 - $probability));
        }

        return (int) round(100 * (1 - $probability) / $probability);
    }
}
