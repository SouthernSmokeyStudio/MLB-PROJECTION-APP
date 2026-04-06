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
        private SSS_MLB_Prepared_Inputs_Repository $prepared_inputs,
        private SSS_MLB_Feature_Builder $feature_builder,
        private SSS_MLB_Formula_F001 $formula_f001,
        private SSS_MLB_Formula_F002 $formula_f002,
        private SSS_MLB_Formula_F003 $formula_f003,
        private SSS_MLB_Formula_F004 $formula_f004,
        private SSS_MLB_Formula_F005 $formula_f005,
        private SSS_MLB_Formula_F007 $formula_f007,
        private SSS_MLB_Release_Manager $release_manager,
        private SSS_MLB_System_State_Repository $system_state,
        private SSS_MLB_Logger $logger
    ) {}

    public function ingest_core_markets(): array {
        $job_key = 'phase1_ingest_core_markets';
        $runner_id = wp_generate_uuid4();

        if (!$this->locks->claim($job_key, $runner_id, 240)) {
            $this->logger->warning($job_key, 'Ingest skipped because another runner owns the lock.');
            return [
                'status' => 'skipped',
                'event_id' => null,
                'market_instance_count' => 0,
                'prepared_input_id' => null,
            ];
        }

        try {
            $seeded = $this->seed_validation_event_market_and_input();
            $this->logger->info($job_key, 'Phase 1 internal validation ingest seed completed.', $seeded);
            return $seeded;
        } catch (Throwable $throwable) {
            $this->logger->error($job_key, 'Phase 1 internal validation ingest seed failed.', [
                'error' => $throwable->getMessage(),
            ]);
            throw $throwable;
        } finally {
            $this->locks->release($job_key);
        }
    }

    public function archive_results(): void {
        $this->run_locked_job('phase1_archive_results', 240, function (string $batch_key): array {
            $this->logger->info($batch_key, 'Phase 1 results archive placeholder executed.');
            return [
                'stubbed' => true,
                'job' => 'archive_results',
            ];
        });
    }

    public function run_full_projection_batch(): array {
        return $this->run_locked_job('phase1_full_projection_batch', 840, function (string $batch_key, string $job_key): array {
            $events = $this->events->get_upcoming_events(25);
            $summary = [
                'status' => 'success',
                'event_count' => count($events),
                'formula_run_count' => 0,
                'projection_count' => 0,
                'release_audit_count' => 0,
                'game_projection_attempts' => 0,
                'player_opportunity_attempts' => 0,
            ];

            foreach ($events as $event) {
                $this->locks->heartbeat($job_key, 840);
                $event_summary = $this->run_event_projection_pipeline($event, $batch_key);
                $summary['game_projection_attempts'] += $event_summary['game_projection_attempts'];
                $summary['player_opportunity_attempts'] += $event_summary['player_opportunity_attempts'];
                $summary['formula_run_count'] += $event_summary['formula_run_count'];
                $summary['projection_count'] += $event_summary['projection_count'];
                $summary['release_audit_count'] += $event_summary['release_audit_count'];
            }

            $this->system_state->set('phase1_publish_safe_scope', [
                'schedule_view' => true,
                'game_projections' => true,
                'limited_player_opportunity' => true,
                'supported_game_markets_only' => true,
                'updated_at_utc' => current_time('mysql', true),
            ]);

            return $summary;
        });
    }

    private function run_event_projection_pipeline(array $event, string $batch_key): array {
        $context_key = 'phase1_event_' . (int) $event['id'];
        $features = $this->feature_builder->build_game_features($event);
        $entity_mapping_status = $this->event_entity_mapping_status($event);
        $starter_confirmed = ($features['starter_confirmed_home'] ?? false) && ($features['starter_confirmed_away'] ?? false);
        $stale_minutes = $this->minutes_since($event['updated_at'] ?? null);
        $required_inputs_complete = !empty($event['scheduled_start_utc']) && !empty($event['home_team_id']) && !empty($event['away_team_id']);

        $f001_version = $this->formula_registry->get_approved_version('F001');
        if (!$this->formula_registry->formula_version_is_approved($f001_version)) {
            $this->logger->error($context_key, 'Missing approved F001 version.');
            return [
                'formula_run_count' => 0,
                'projection_count' => 0,
                'release_audit_count' => 0,
                'game_projection_attempts' => 0,
                'player_opportunity_attempts' => 0,
            ];
        }

        $f001 = $this->formula_f001->run($features);
        $f001_run_id = $this->insert_formula_run($f001_version, 'event:' . (int) $event['id'], $batch_key);

        if ($f001_run_id <= 0) {
            throw new RuntimeException('F001 formula run insert did not return a valid run id.');
        }

        $base_release = [
            'event_id' => (int) $event['id'],
            'stale_minutes' => $stale_minutes,
            'starter_confirmed' => $starter_confirmed,
            'entity_mapping_status' => $entity_mapping_status,
            'required_inputs_complete' => $required_inputs_complete,
            'data_quality_score' => $f001['data_quality_score'],
            'stability_score' => $f001['stability_score'],
        ];

        $projection_count = 0;
        $release_audit_count = 0;
        $game_projection_attempts = 0;
        foreach ([
            ['home_win_probability', $f001['p_home_win'], null],
            ['away_win_probability', $f001['p_away_win'], null],
            ['home_team_runs', null, $f001['mu_home_runs']],
            ['away_team_runs', null, $f001['mu_away_runs']],
        ] as $row) {
            $artifact_counts = $this->persist_projection_attempt($event, [
                'output_family' => 'game_projection',
                'output_label' => $row[0],
                'formula_version' => $f001_version,
                'formula_run_id' => $f001_run_id,
                'fair_probability' => $row[1],
                'point_estimate' => $row[2],
                'distribution_payload' => null,
                'fair_line' => null,
                'market_type_key' => null,
                'parent_distribution_ready' => true,
            ], array_merge($base_release, [
                'formula_version_key' => $f001_version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'home_field_effect' => $features['home_field_effect'] ?? null,
                'home_offense' => $features['home_offense'] ?? null,
                'away_offense' => $features['away_offense'] ?? null,
            ]);
            $projection_count += $artifact_counts['projection_count'];
            $release_audit_count += $artifact_counts['release_audit_count'];
            $game_projection_attempts++;
        }

        $market_projection_summary = $this->persist_market_projections($event, $batch_key, $base_release, $f001, $f001_version);
        $game_projection_attempts += $market_projection_summary['attempt_count'];
        $projection_count += $market_projection_summary['projection_count'];
        $release_audit_count += $market_projection_summary['release_audit_count'];
        $player_opportunity_attempts = $this->persist_player_opportunity_projections($event, $batch_key);

        $this->logger->info($context_key, 'Phase 1 event projection completed.', [
            'event_id' => $event['id'],
            'batch_key' => $batch_key,
            'formula_run_count' => 6,
            'projection_count' => $projection_count,
            'release_audit_count' => $release_audit_count,
            'game_projection_attempts' => $game_projection_attempts,
            'player_opportunity_attempts' => $player_opportunity_attempts,
        ]);

        return [
            'formula_run_count' => 6,
            'projection_count' => $projection_count,
            'release_audit_count' => $release_audit_count,
            'game_projection_attempts' => $game_projection_attempts,
            'player_opportunity_attempts' => $player_opportunity_attempts,
        ];
    }

    private function persist_market_projections(array $event, string $batch_key, array $base_release, array $f001, array $f001_version): array {
        $summary = [
            'attempt_count' => 0,
            'projection_count' => 0,
            'release_audit_count' => 0,
        ];

        foreach ([['moneyline_home', $f001['p_home_win']], ['moneyline_away', $f001['p_away_win']]] as $row) {
            $run_id = $this->insert_formula_run($f001_version, 'event:' . (int) $event['id'] . ':' . $row[0], $batch_key);
            $artifact_counts = $this->persist_projection_attempt($event, [
                'output_family' => 'betting_projection',
                'output_label' => $row[0],
                'formula_version' => $f001_version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => null,
                'distribution_payload' => null,
                'fair_line' => null,
                'market_type_key' => 'mlb_game_moneyline_full_game',
                'parent_distribution_ready' => true,
            ], array_merge($base_release, [
                'formula_version_key' => $f001_version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'market_family' => 'moneyline',
            ]);
            $summary['attempt_count']++;
            $summary['projection_count'] += $artifact_counts['projection_count'];
            $summary['release_audit_count'] += $artifact_counts['release_audit_count'];
        }

        $f002_summary = $this->persist_f002_rows($event, $batch_key, $base_release, $f001);
        $summary['attempt_count'] += $f002_summary['attempt_count'];
        $summary['projection_count'] += $f002_summary['projection_count'];
        $summary['release_audit_count'] += $f002_summary['release_audit_count'];

        $f003_summary = $this->persist_f003_rows($event, $batch_key, $base_release, $f001);
        $summary['attempt_count'] += $f003_summary['attempt_count'];
        $summary['projection_count'] += $f003_summary['projection_count'];
        $summary['release_audit_count'] += $f003_summary['release_audit_count'];

        $f004_summary = $this->persist_f004_rows($event, $batch_key, $base_release, $f001);
        $summary['attempt_count'] += $f004_summary['attempt_count'];
        $summary['projection_count'] += $f004_summary['projection_count'];
        $summary['release_audit_count'] += $f004_summary['release_audit_count'];

        return $summary;
    }

    private function persist_f002_rows(array $event, string $batch_key, array $base_release, array $f001): array {
        $version = $this->formula_registry->get_approved_version('F002');
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];
        }

        $result = $this->formula_f002->run($f001);
        $run_id = $this->insert_formula_run($version, 'event:' . (int) $event['id'] . ':F002', $batch_key);
        $rows = [
            ['run_line_home_minus_1_5', $result['run_line_home_minus_1_5_prob'], -1.5],
            ['run_line_away_plus_1_5', $result['run_line_away_plus_1_5_prob'], 1.5],
        ];
        $summary = ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];

        foreach ($rows as $row) {
            $artifact_counts = $this->persist_projection_attempt($event, [
                'output_family' => 'betting_projection',
                'output_label' => $row[0],
                'formula_version' => $version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => null,
                'distribution_payload' => wp_json_encode($result['distribution_payload']),
                'fair_line' => $row[2],
                'market_type_key' => 'mlb_game_run_line_full_game',
                'parent_distribution_ready' => true,
            ], array_merge($base_release, [
                'formula_version_key' => $version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'distribution_type' => 'run_margin',
            ]);
            $summary['attempt_count']++;
            $summary['projection_count'] += $artifact_counts['projection_count'];
            $summary['release_audit_count'] += $artifact_counts['release_audit_count'];
        }

        return $summary;
    }

    private function persist_f003_rows(array $event, string $batch_key, array $base_release, array $f001): array {
        $version = $this->formula_registry->get_approved_version('F003');
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];
        }

        $result = $this->formula_f003->run($f001);
        $run_id = $this->insert_formula_run($version, 'event:' . (int) $event['id'] . ':F003', $batch_key);
        $rows = [
            ['total_over_8_5', $result['total_over_8_5_prob'], 8.5],
            ['total_under_8_5', $result['total_under_8_5_prob'], 8.5],
        ];
        $summary = ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];

        foreach ($rows as $row) {
            $artifact_counts = $this->persist_projection_attempt($event, [
                'output_family' => 'betting_projection',
                'output_label' => $row[0],
                'formula_version' => $version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => $result['mean_total_runs'],
                'distribution_payload' => wp_json_encode($result['distribution_payload']),
                'fair_line' => $row[2],
                'market_type_key' => 'mlb_game_total_full_game',
                'parent_distribution_ready' => true,
            ], array_merge($base_release, [
                'formula_version_key' => $version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'distribution_type' => 'total_runs',
            ]);
            $summary['attempt_count']++;
            $summary['projection_count'] += $artifact_counts['projection_count'];
            $summary['release_audit_count'] += $artifact_counts['release_audit_count'];
        }

        return $summary;
    }

    private function persist_f004_rows(array $event, string $batch_key, array $base_release, array $f001): array {
        $version = $this->formula_registry->get_approved_version('F004');
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];
        }

        $result = $this->formula_f004->run($f001);
        $run_id = $this->insert_formula_run($version, 'event:' . (int) $event['id'] . ':F004', $batch_key);
        $rows = [
            ['home_team_total_over_4_5', $result['home_team_over_4_5_prob'], $result['home_team_total_mean'], 4.5],
            ['home_team_total_under_4_5', round(1 - $result['home_team_over_4_5_prob'], 6), $result['home_team_total_mean'], 4.5],
            ['away_team_total_over_4_5', $result['away_team_over_4_5_prob'], $result['away_team_total_mean'], 4.5],
            ['away_team_total_under_4_5', round(1 - $result['away_team_over_4_5_prob'], 6), $result['away_team_total_mean'], 4.5],
        ];
        $summary = ['attempt_count' => 0, 'projection_count' => 0, 'release_audit_count' => 0];

        foreach ($rows as $row) {
            $artifact_counts = $this->persist_projection_attempt($event, [
                'output_family' => 'betting_projection',
                'output_label' => $row[0],
                'formula_version' => $version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => $row[2],
                'distribution_payload' => null,
                'fair_line' => $row[3],
                'market_type_key' => 'mlb_team_total_full_game',
                'parent_distribution_ready' => true,
            ], array_merge($base_release, [
                'formula_version_key' => $version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'distribution_type' => 'team_total',
            ]);
            $summary['attempt_count']++;
            $summary['projection_count'] += $artifact_counts['projection_count'];
            $summary['release_audit_count'] += $artifact_counts['release_audit_count'];
        }

        return $summary;
    }

    private function persist_player_opportunity_projections(array $event, string $batch_key): int {
        $attempts = 0;
        $prepared_inputs = $this->prepared_inputs->get_player_opportunity_inputs_for_event((int) $event['id']);

        foreach ($prepared_inputs as $prepared_input) {
            $features = $this->feature_builder->build_opportunity_features_from_prepared_input($prepared_input);
            $release_base = [
                'event_id' => (int) $event['id'],
                'stale_minutes' => $this->minutes_since($prepared_input['prepared_at_utc'] ?? null),
                'starter_confirmed' => true,
                'entity_mapping_status' => !empty($prepared_input['subject_id']) ? 'mapped' : 'failed',
                'required_inputs_complete' => ($prepared_input['validation_status'] ?? '') === 'valid',
                'data_quality_score' => 0.70,
                'stability_score' => 0.65,
            ];

            if (($prepared_input['feature_set_key'] ?? '') === 'phase1_hitter_opportunity') {
                $attempts += $this->persist_hitter_opportunity_rows($event, $prepared_input, $features, $batch_key, $release_base);
            }

            if (($prepared_input['feature_set_key'] ?? '') === 'phase1_pitcher_opportunity') {
                $attempts += $this->persist_pitcher_opportunity_rows($event, $prepared_input, $features, $batch_key, $release_base);
            }
        }

        return $attempts;
    }

    private function persist_hitter_opportunity_rows(array $event, array $prepared_input, array $features, string $batch_key, array $release_base): int {
        $version = $this->formula_registry->get_approved_version('F005');
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return 0;
        }

        $result = $this->formula_f005->run($features);
        $run_id = $this->insert_formula_run($version, 'prepared_input:' . (int) $prepared_input['id'], $batch_key);
        $rows = [
            ['hitter_start_probability', $result['p_start'], null, null],
            ['hitter_lineup_slot_band', null, null, wp_json_encode(['slot_band_low' => $result['slot_band_low'], 'slot_band_high' => $result['slot_band_high']])],
            ['hitter_expected_plate_appearances', null, $result['expected_plate_appearances'], wp_json_encode($result['distribution_payload'])],
        ];

        foreach ($rows as $row) {
            $this->persist_projection_attempt($event, [
                'output_family' => 'player_opportunity',
                'output_label' => $row[0],
                'formula_version' => $version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => $row[2],
                'distribution_payload' => $row[3],
                'fair_line' => null,
                'market_type_key' => null,
                'prepared_input_id' => (int) $prepared_input['id'],
                'parent_distribution_ready' => true,
            ], array_merge($release_base, [
                'formula_version_key' => $version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'subject_id' => (int) $prepared_input['subject_id'],
                'feature_set_key' => $prepared_input['feature_set_key'],
            ]);
        }

        return count($rows);
    }

    private function persist_pitcher_opportunity_rows(array $event, array $prepared_input, array $features, string $batch_key, array $release_base): int {
        $version = $this->formula_registry->get_approved_version('F007');
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return 0;
        }

        $result = $this->formula_f007->run($features);
        $run_id = $this->insert_formula_run($version, 'prepared_input:' . (int) $prepared_input['id'], $batch_key);
        $rows = [
            ['pitcher_start_probability', $result['p_start'], null, null],
            ['pitcher_expected_pitch_count', null, $result['expected_pitch_count'], wp_json_encode($result['distribution_payload'])],
            ['pitcher_expected_batters_faced', null, $result['expected_batters_faced'], wp_json_encode($result['distribution_payload'])],
            ['pitcher_expected_outs_recorded', null, $result['expected_outs_recorded'], wp_json_encode($result['distribution_payload'])],
        ];

        foreach ($rows as $row) {
            $this->persist_projection_attempt($event, [
                'output_family' => 'player_opportunity',
                'output_label' => $row[0],
                'formula_version' => $version,
                'formula_run_id' => $run_id,
                'fair_probability' => $row[1],
                'point_estimate' => $row[2],
                'distribution_payload' => $row[3],
                'fair_line' => null,
                'market_type_key' => null,
                'prepared_input_id' => (int) $prepared_input['id'],
                'parent_distribution_ready' => true,
            ], array_merge($release_base, [
                'formula_version_key' => $version['version_key'],
                'formula_version_approved' => true,
            ]), [
                'subject_id' => (int) $prepared_input['subject_id'],
                'feature_set_key' => $prepared_input['feature_set_key'],
            ]);
        }

        return count($rows);
    }

    private function insert_formula_run(?array $version, string $subject_ref, string $batch_key): int {
        if (!$this->formula_registry->formula_version_is_approved($version)) {
            return 0;
        }

        return $this->projections->insert_formula_run([
            'run_key' => 'run_' . wp_generate_uuid4(),
            'formula_version_id' => $version['id'],
            'run_type' => 'live_publish',
            'run_status' => 'completed',
            'triggered_at_utc' => current_time('mysql', true),
            'completed_at_utc' => current_time('mysql', true),
            'code_ref' => 'plugin:' . SSS_MLB_PLUGIN_VERSION,
            'config_hash' => md5(SSS_MLB_ACTIVE_FORMULA_BUNDLE . ':' . $subject_ref),
            'notes' => 'Phase 1 batch ' . $batch_key,
            'created_at' => current_time('mysql', true),
        ]);
    }

    private function persist_projection_attempt(array $event, array $projection_row, array $release_candidate, array $top_drivers): array {
        $version = $projection_row['formula_version'] ?? null;
        $release = $this->release_manager->evaluate(array_merge($release_candidate, [
            'output_family' => $projection_row['output_family'],
            'market_type_key' => $projection_row['market_type_key'] ?? null,
            'parent_distribution_ready' => $projection_row['parent_distribution_ready'] ?? true,
        ]));

        $projection_id = $this->projections->insert_projection([
            'projection_key' => 'proj_' . wp_generate_uuid4(),
            'formula_run_id' => $projection_row['formula_run_id'],
            'formula_version_id' => $version['id'] ?? 0,
            'event_id' => (int) $event['id'],
            'market_instance_id' => null,
            'selection_id' => null,
            'prepared_input_id' => $projection_row['prepared_input_id'] ?? null,
            'projected_at_utc' => current_time('mysql', true),
            'output_family' => $projection_row['output_family'],
            'output_label' => $projection_row['output_label'],
            'fair_probability' => $projection_row['fair_probability'],
            'fair_odds_american' => $this->probability_to_american($projection_row['fair_probability']),
            'fair_odds_decimal' => $projection_row['fair_probability'] ? round(1 / max(0.0001, $projection_row['fair_probability']), 6) : null,
            'fair_line' => $projection_row['fair_line'],
            'point_estimate' => $projection_row['point_estimate'],
            'distribution_payload' => $projection_row['distribution_payload'],
            'confidence_band' => 'phase1_provisional',
            'stability_score' => $release_candidate['stability_score'],
            'data_quality_score' => $release_candidate['data_quality_score'],
            'release_decision' => $release['release_decision'],
            'release_reason' => empty($release['failure_codes']) ? null : implode(',', $release['failure_codes']),
            'top_drivers' => wp_json_encode($top_drivers),
            'omissions' => wp_json_encode(['player_props' => 'Not supported in Phase 1.', 'dfs' => 'Not supported in Phase 1.']),
            'created_at' => current_time('mysql', true),
        ]);

        if ($projection_id <= 0) {
            throw new RuntimeException('Projection insert did not return a valid projection id.');
        }

        $this->projections->insert_release_audit([
            'projection_id' => $projection_id,
            'release_rule_id' => (int) $release['release_rule_id'],
            'audit_time_utc' => current_time('mysql', true),
            'passed' => $release['passed'] ? 1 : 0,
            'failure_codes' => wp_json_encode($release['failure_codes']),
            'notes' => $release['passed'] ? 'Published by Phase 1 release filter.' : 'Blocked by Phase 1 release filter.',
            'created_at' => current_time('mysql', true),
        ]);

        return [
            'projection_count' => 1,
            'release_audit_count' => 1,
        ];
    }

    private function run_locked_job(string $job_key, int $ttl_seconds, callable $callback): array {
        $runner_id = wp_generate_uuid4();
        $batch_key = $job_key . '_' . wp_generate_uuid4();
        $started_at = current_time('mysql', true);

        if (!$this->locks->claim($job_key, $runner_id, $ttl_seconds)) {
            $skipped = ['job_key' => $job_key, 'status' => 'skipped_lock', 'runner_id' => $runner_id, 'skipped_at_utc' => $started_at];
            $this->system_state->set('job_status_' . $job_key, $skipped);
            $this->system_state->append_event('job_history_' . $job_key, $skipped);
            $this->logger->warning($job_key, 'Job skipped because another runner owns the lock.', $skipped);
            return [
                'status' => 'skipped',
                'event_count' => 0,
                'formula_run_count' => 0,
                'projection_count' => 0,
                'release_audit_count' => 0,
            ];
        }

        $running_state = ['job_key' => $job_key, 'batch_key' => $batch_key, 'runner_id' => $runner_id, 'status' => 'running', 'started_at_utc' => $started_at];
        $this->system_state->set('job_status_' . $job_key, $running_state);
        $this->system_state->append_event('job_history_' . $job_key, $running_state);
        $this->logger->info($job_key, 'Job started.', $running_state);

        try {
            $summary = $callback($batch_key, $job_key);
            $completed = array_merge($running_state, ['status' => 'completed', 'completed_at_utc' => current_time('mysql', true), 'summary' => $summary]);
            $this->system_state->set('job_status_' . $job_key, $completed);
            $this->system_state->append_event('job_history_' . $job_key, $completed);
            $this->logger->info($job_key, 'Job completed.', $completed);
            $this->locks->release($job_key);
            return $summary;
        } catch (Throwable $throwable) {
            $failed = array_merge($running_state, ['status' => 'failed', 'failed_at_utc' => current_time('mysql', true), 'error' => $throwable->getMessage()]);
            $this->system_state->set('job_status_' . $job_key, $failed);
            $this->system_state->append_event('job_history_' . $job_key, $failed);
            $this->logger->error($job_key, 'Job failed.', $failed);
            $this->locks->mark_failed($job_key);
            throw $throwable;
        }
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

    private function minutes_since(?string $timestamp): int {
        if ($timestamp === null || $timestamp === '') {
            return 9999;
        }

        $delta = time() - strtotime($timestamp);
        return (int) max(0, floor($delta / 60));
    }

    private function event_entity_mapping_status(array $event): string {
        if (empty($event['home_team_id']) || empty($event['away_team_id'])) {
            return 'failed';
        }

        return 'mapped';
    }

    private function seed_validation_event_market_and_input(): array {
        $now_utc = current_time('mysql', true);
        [$home_team_id, $away_team_id] = $this->get_validation_seed_team_ids();

        if ((int) $home_team_id <= 0 || (int) $away_team_id <= 0 || (int) $home_team_id === (int) $away_team_id) {
            throw new RuntimeException('Validation demo event payload contains invalid team ids before upsert.');
        }

        $event = [
            'league_id' => $this->get_mlb_league_id(),
            'event_key' => 'validation_demo_phase1a_event',
            'status' => 'scheduled',
            'event_type' => 'internal_validation_demo',
            'scheduled_start_utc' => gmdate('Y-m-d H:i:s', strtotime('+2 hours', current_time('timestamp', true))),
            'home_team_id' => $home_team_id,
            'away_team_id' => $away_team_id,
            'venue_id' => null,
            'neutral_site' => 0,
            'event_label' => 'INTERNAL VALIDATION DEMO: Phase 1A Seed Event',
            'created_at' => $now_utc,
            'updated_at' => $now_utc,
        ];

        $event_id = $this->events->upsert_demo_event($event);

        if ($event_id <= 0) {
            throw new RuntimeException('Validation demo event write returned an invalid event id.');
        }

        $event_row = $this->events->get_event($event_id);

        if (!$event_row || ($event_row['event_key'] ?? '') !== 'validation_demo_phase1a_event') {
            throw new RuntimeException('Validation demo event row was not found after write.');
        }

        $persisted_home_team_id = (int) ($event_row['home_team_id'] ?? 0);
        $persisted_away_team_id = (int) ($event_row['away_team_id'] ?? 0);

        if (
            $persisted_home_team_id <= 0
            || $persisted_away_team_id <= 0
            || $persisted_home_team_id === $persisted_away_team_id
        ) {
            throw new RuntimeException('Validation demo event row did not persist distinct non-null team ids after upsert.');
        }

        $provider_id = $this->markets->get_provider_id_by_key('draftkings_sportsbook');
        $market_type_id = $this->markets->get_market_type_id_by_key('mlb_game_moneyline_full_game');

        if ($provider_id <= 0 || $market_type_id <= 0) {
            throw new RuntimeException('Missing validation seed provider or market type dependency.');
        }

        $market_instance_id = $this->markets->upsert_market_instance([
            'provider_id' => $provider_id,
            'event_id' => $event_id,
            'market_type_id' => $market_type_id,
            'provider_market_id' => 'validation_demo_phase1a_moneyline',
            'market_status' => 'open',
            'listed_at_utc' => $now_utc,
            'last_seen_at_utc' => $now_utc,
            'parent_market_instance_id' => null,
            'source_hash' => md5('validation_demo_phase1a_moneyline'),
            'created_at' => $now_utc,
            'updated_at' => $now_utc,
        ]);

        $home_selection_id = $this->markets->upsert_selection([
            'market_instance_id' => $market_instance_id,
            'provider_selection_id' => 'validation_demo_phase1a_home',
            'selection_role' => 'home',
            'selection_label' => 'INTERNAL VALIDATION DEMO: Home Moneyline',
            'participant_type' => 'team',
            'team_id' => null,
            'player_id' => null,
            'line_value' => null,
            'line_unit' => null,
            'band_low' => null,
            'band_high' => null,
            'rank_order' => 1,
            'is_active' => 1,
            'created_at' => $now_utc,
            'updated_at' => $now_utc,
        ]);

        $away_selection_id = $this->markets->upsert_selection([
            'market_instance_id' => $market_instance_id,
            'provider_selection_id' => 'validation_demo_phase1a_away',
            'selection_role' => 'away',
            'selection_label' => 'INTERNAL VALIDATION DEMO: Away Moneyline',
            'participant_type' => 'team',
            'team_id' => null,
            'player_id' => null,
            'line_value' => null,
            'line_unit' => null,
            'band_low' => null,
            'band_high' => null,
            'rank_order' => 2,
            'is_active' => 1,
            'created_at' => $now_utc,
            'updated_at' => $now_utc,
        ]);

        $this->markets->insert_odds_snapshot_if_missing([
            'market_instance_id' => $market_instance_id,
            'selection_id' => $home_selection_id,
            'captured_at_utc' => $now_utc,
            'odds_american' => -118,
            'odds_decimal' => 1.847458,
            'implied_prob_raw' => 0.541284,
            'line_value' => null,
            'availability_status' => 'validation_demo',
            'limit_tier' => 'internal_validation',
            'source_payload_hash' => md5('validation_demo_phase1a_home_odds'),
            'source_json' => wp_json_encode([
                'seed_type' => 'internal_validation_demo',
                'seed_reason' => 'Phase 1A deterministic runtime proof',
                'truth_status' => 'not_live_provider_truth',
            ]),
            'created_at' => $now_utc,
        ]);

        $this->markets->insert_odds_snapshot_if_missing([
            'market_instance_id' => $market_instance_id,
            'selection_id' => $away_selection_id,
            'captured_at_utc' => $now_utc,
            'odds_american' => 102,
            'odds_decimal' => 2.020000,
            'implied_prob_raw' => 0.495050,
            'line_value' => null,
            'availability_status' => 'validation_demo',
            'limit_tier' => 'internal_validation',
            'source_payload_hash' => md5('validation_demo_phase1a_away_odds'),
            'source_json' => wp_json_encode([
                'seed_type' => 'internal_validation_demo',
                'seed_reason' => 'Phase 1A deterministic runtime proof',
                'truth_status' => 'not_live_provider_truth',
            ]),
            'created_at' => $now_utc,
        ]);

        $prepared_input_id = $this->upsert_validation_game_prepared_input($event_id, $market_instance_id, [
            'home_offense' => 1.02,
            'away_offense' => 0.98,
            'home_starter_quality' => 0.12,
            'away_starter_quality' => 0.09,
            'home_bullpen_quality' => 0.05,
            'away_bullpen_quality' => 0.02,
            'park_run_factor' => 1.00,
            'weather_factor' => 1.00,
            'home_field_effect' => 0.07,
            'volatility_factor' => 0.04,
            'lineup_confirmed_home' => false,
            'lineup_confirmed_away' => false,
            'starter_confirmed_home' => true,
            'starter_confirmed_away' => true,
        ]);

        return [
            'status' => 'success',
            'seed_type' => 'internal_validation_demo',
            'event_id' => $event_id,
            'market_instance_id' => $market_instance_id,
            'market_instance_count' => 1,
            'prepared_input_id' => $prepared_input_id,
        ];
    }

    private function upsert_validation_game_prepared_input(int $event_id, int $market_instance_id, array $feature_vector): int {
        $feature_set_id = $this->prepared_inputs->get_feature_set_id('phase1_game_environment');

        if ($feature_set_id <= 0) {
            throw new RuntimeException('Missing phase1_game_environment feature set for validation seed.');
        }

        return $this->prepared_inputs->upsert_validation_game_input([
            'prepared_input_key' => 'validation_demo_phase1a_game_environment_' . $event_id,
            'event_id' => $event_id,
            'subject_type' => 'event',
            'subject_id' => $event_id,
            'feature_set_id' => $feature_set_id,
            'prepared_at_utc' => current_time('mysql', true),
            'validation_status' => 'valid',
            'blocked_reason' => null,
            'source_snapshot_refs' => wp_json_encode([
                'seed_type' => 'internal_validation_demo',
                'seed_reason' => 'Phase 1A deterministic runtime proof',
                'truth_status' => 'not_live_provider_truth',
                'market_instance_id' => $market_instance_id,
            ]),
            'feature_vector' => wp_json_encode(array_merge($feature_vector, [
                'seed_type' => 'internal_validation_demo',
                'seed_reason' => 'Phase 1A deterministic runtime proof',
                'truth_status' => 'not_live_provider_truth',
            ])),
            'created_at' => current_time('mysql', true),
        ]);
    }

    private function get_mlb_league_id(): int {
        global $wpdb;

        $league_id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}sss_mlb_leagues WHERE league_key = %s LIMIT 1",
            'mlb'
        ));

        if ($league_id <= 0) {
            throw new RuntimeException('Missing MLB league seed row for validation event.');
        }

        return $league_id;
    }

    private function get_validation_seed_team_ids(): array {
        global $wpdb;

        $league_id = $this->get_mlb_league_id();
        $team_rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id
             FROM {$wpdb->prefix}sss_mlb_teams
             WHERE league_id = %d
             ORDER BY id ASC
             LIMIT 2",
            $league_id
        ), ARRAY_A);

        if (!is_array($team_rows) || count($team_rows) < 2) {
            throw new RuntimeException('Validation seed requires two seeded MLB teams, but fewer than two were found.');
        }

        $home_team_id = (int) ($team_rows[0]['id'] ?? 0);
        $away_team_id = (int) ($team_rows[1]['id'] ?? 0);

        if ($home_team_id <= 0 || $away_team_id <= 0 || $home_team_id === $away_team_id) {
            throw new RuntimeException('Validation seed requires two distinct seeded MLB team ids.');
        }

        return [$home_team_id, $away_team_id];
    }
}
