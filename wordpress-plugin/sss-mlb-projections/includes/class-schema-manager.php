<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Schema_Manager {
    private const PHASE1_COVERAGE_VALID_FROM = '2026-03-29 00:00:00';

    public function install_or_upgrade(): array {
        global $wpdb;

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $collate = $wpdb->get_charset_collate();
        $now = current_time('mysql', true);
        $previous_plugin_version = (string) get_option('sss_mlb_plugin_version', '');
        $previous_schema_version = (string) get_option('sss_mlb_schema_version', '');

        $action = 'noop';
        if ($previous_schema_version === '') {
            $action = 'install';
        } elseif ($previous_schema_version !== SSS_MLB_SCHEMA_VERSION || $previous_plugin_version !== SSS_MLB_PLUGIN_VERSION) {
            $action = 'upgrade';
        }

        foreach ($this->get_table_sql($collate) as $sql) {
            dbDelta($sql);
        }

        update_option('sss_mlb_plugin_version', SSS_MLB_PLUGIN_VERSION);
        update_option('sss_mlb_schema_version', SSS_MLB_SCHEMA_VERSION);
        update_option('sss_mlb_active_formula_bundle', SSS_MLB_ACTIVE_FORMULA_BUNDLE);

        $this->seed_reference_rows();

        return [
            'action' => $action,
            'status' => 'completed',
            'ran_at_utc' => $now,
            'plugin_version' => SSS_MLB_PLUGIN_VERSION,
            'schema_version' => SSS_MLB_SCHEMA_VERSION,
            'previous_plugin_version' => $previous_plugin_version === '' ? null : $previous_plugin_version,
            'previous_schema_version' => $previous_schema_version === '' ? null : $previous_schema_version,
        ];
    }

    public function table(string $suffix): string {
        global $wpdb;
        return "{$wpdb->prefix}sss_mlb_{$suffix}";
    }

    /**
     * Phase 1 keeps hot read columns relational and leaves cold metadata in LONGTEXT JSON blobs.
     * MariaDB/MySQL validation belongs in PHP plus unique keys, not fragile CHECK rules.
     *
     * @return string[]
     */
    public function get_table_sql(string $collate): array {
        $tables = [];

        $tables[] = "CREATE TABLE {$this->table('providers')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            provider_key VARCHAR(64) NOT NULL,
            provider_type VARCHAR(32) NOT NULL,
            provider_name VARCHAR(128) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY provider_key (provider_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('sports')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            sport_key VARCHAR(32) NOT NULL,
            sport_name VARCHAR(64) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY sport_key (sport_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('leagues')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            sport_id BIGINT UNSIGNED NOT NULL,
            league_key VARCHAR(32) NOT NULL,
            league_name VARCHAR(128) NOT NULL,
            season_type_default VARCHAR(32) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY league_key (league_key),
            KEY sport_id (sport_id)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('teams')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            league_id BIGINT UNSIGNED NOT NULL,
            team_key VARCHAR(64) NOT NULL,
            team_name VARCHAR(128) NOT NULL,
            team_abbr VARCHAR(8) NOT NULL,
            city_name VARCHAR(128) NOT NULL,
            valid_from DATE NOT NULL,
            valid_to DATE NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY team_key (team_key),
            KEY league_id (league_id),
            KEY team_abbr (team_abbr)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('players')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            league_id BIGINT UNSIGNED NOT NULL,
            player_key VARCHAR(64) NOT NULL,
            full_name VARCHAR(190) NOT NULL,
            first_name VARCHAR(96) NOT NULL,
            last_name VARCHAR(96) NOT NULL,
            handedness VARCHAR(4) NULL,
            primary_position VARCHAR(16) NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY player_key (player_key),
            KEY league_id (league_id),
            KEY player_name (last_name, first_name)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('venues')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            venue_key VARCHAR(64) NOT NULL,
            venue_name VARCHAR(190) NOT NULL,
            city VARCHAR(128) NULL,
            state_region VARCHAR(64) NULL,
            roof_type VARCHAR(32) NULL,
            indoor_flag TINYINT(1) NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY venue_key (venue_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('provider_entity_map')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            provider_id BIGINT UNSIGNED NOT NULL,
            entity_type VARCHAR(32) NOT NULL,
            provider_entity_id VARCHAR(128) NOT NULL,
            canonical_entity_type VARCHAR(32) NOT NULL,
            canonical_entity_id BIGINT UNSIGNED NOT NULL,
            mapping_status VARCHAR(32) NOT NULL,
            confidence_score DECIMAL(5,4) NOT NULL,
            valid_from DATETIME NOT NULL,
            valid_to DATETIME NULL,
            notes LONGTEXT NULL,
            created_by VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY provider_entity_version (provider_id, entity_type, provider_entity_id, valid_from),
            KEY canonical_lookup (canonical_entity_type, canonical_entity_id)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('events')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            league_id BIGINT UNSIGNED NOT NULL,
            event_key VARCHAR(96) NOT NULL,
            status VARCHAR(32) NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            scheduled_start_utc DATETIME NOT NULL,
            home_team_id BIGINT UNSIGNED NULL,
            away_team_id BIGINT UNSIGNED NULL,
            venue_id BIGINT UNSIGNED NULL,
            neutral_site TINYINT(1) NOT NULL DEFAULT 0,
            event_label VARCHAR(190) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY event_key (event_key),
            KEY league_start (league_id, scheduled_start_utc),
            KEY team_start (home_team_id, away_team_id, scheduled_start_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('settlement_rules')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            settlement_rule_key VARCHAR(96) NOT NULL,
            rule_name VARCHAR(190) NOT NULL,
            applies_to VARCHAR(96) NOT NULL,
            push_logic TEXT NOT NULL,
            void_logic TEXT NOT NULL,
            official_source_priority LONGTEXT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY settlement_rule_key (settlement_rule_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('market_types')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            market_type_key VARCHAR(96) NOT NULL,
            sport_key VARCHAR(32) NOT NULL,
            league_key VARCHAR(32) NOT NULL,
            market_family VARCHAR(32) NOT NULL,
            subject_type VARCHAR(32) NOT NULL,
            stat_type VARCHAR(64) NULL,
            segment_type VARCHAR(32) NOT NULL,
            outcome_type VARCHAR(32) NOT NULL,
            line_type VARCHAR(32) NULL,
            pricing_method VARCHAR(32) NOT NULL,
            parent_distribution_type VARCHAR(64) NULL,
            settlement_rule_key VARCHAR(96) NOT NULL,
            support_tier VARCHAR(32) NOT NULL,
            push_allowed TINYINT(1) NOT NULL DEFAULT 0,
            voidable TINYINT(1) NOT NULL DEFAULT 1,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY market_type_key (market_type_key),
            KEY scope_lookup (sport_key, league_key, market_family, segment_type)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('market_instances')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            provider_id BIGINT UNSIGNED NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            market_type_id BIGINT UNSIGNED NOT NULL,
            provider_market_id VARCHAR(128) NOT NULL,
            market_status VARCHAR(32) NOT NULL,
            listed_at_utc DATETIME NOT NULL,
            last_seen_at_utc DATETIME NOT NULL,
            parent_market_instance_id BIGINT UNSIGNED NULL,
            source_hash VARCHAR(64) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY provider_market_unique (provider_id, provider_market_id),
            KEY event_market (event_id, market_type_id, market_status),
            KEY parent_market (parent_market_instance_id)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('selections')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            market_instance_id BIGINT UNSIGNED NOT NULL,
            provider_selection_id VARCHAR(128) NULL,
            selection_role VARCHAR(32) NOT NULL,
            selection_label VARCHAR(190) NOT NULL,
            participant_type VARCHAR(32) NOT NULL,
            team_id BIGINT UNSIGNED NULL,
            player_id BIGINT UNSIGNED NULL,
            line_value DECIMAL(12,4) NULL,
            line_unit VARCHAR(32) NULL,
            band_low DECIMAL(12,4) NULL,
            band_high DECIMAL(12,4) NULL,
            rank_order INT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY market_instance_id (market_instance_id),
            KEY player_id (player_id),
            KEY team_id (team_id)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('odds_snapshots')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            market_instance_id BIGINT UNSIGNED NOT NULL,
            selection_id BIGINT UNSIGNED NOT NULL,
            captured_at_utc DATETIME NOT NULL,
            odds_american INT NULL,
            odds_decimal DECIMAL(12,6) NULL,
            implied_prob_raw DECIMAL(12,6) NULL,
            line_value DECIMAL(12,4) NULL,
            availability_status VARCHAR(32) NOT NULL,
            limit_tier VARCHAR(32) NULL,
            source_payload_hash VARCHAR(64) NOT NULL,
            source_json LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY selection_time (selection_id, captured_at_utc),
            KEY market_time (market_instance_id, captured_at_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('market_results')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            market_instance_id BIGINT UNSIGNED NOT NULL,
            selection_id BIGINT UNSIGNED NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            settled_at_utc DATETIME NOT NULL,
            result_grade VARCHAR(32) NOT NULL,
            settlement_value_numeric DECIMAL(12,4) NULL,
            settlement_value_text VARCHAR(190) NULL,
            settlement_rule_key VARCHAR(96) NOT NULL,
            reviewed_flag TINYINT(1) NOT NULL DEFAULT 0,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY market_selection_result (market_instance_id, selection_id),
            KEY event_grade (event_id, result_grade, settled_at_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('feature_sets')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            feature_set_key VARCHAR(96) NOT NULL,
            feature_set_name VARCHAR(190) NOT NULL,
            description TEXT NOT NULL,
            source_code_ref VARCHAR(128) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY feature_set_key (feature_set_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('prepared_inputs')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            prepared_input_key VARCHAR(128) NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            subject_type VARCHAR(32) NOT NULL,
            subject_id BIGINT UNSIGNED NOT NULL,
            feature_set_id BIGINT UNSIGNED NOT NULL,
            prepared_at_utc DATETIME NOT NULL,
            validation_status VARCHAR(32) NOT NULL,
            blocked_reason VARCHAR(190) NULL,
            source_snapshot_refs LONGTEXT NULL,
            feature_vector LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY prepared_input_key (prepared_input_key),
            KEY subject_lookup (event_id, subject_type, subject_id, prepared_at_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('formulas')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            formula_key VARCHAR(32) NOT NULL,
            formula_name VARCHAR(190) NOT NULL,
            objective TEXT NOT NULL,
            prediction_unit VARCHAR(64) NOT NULL,
            output_type VARCHAR(64) NOT NULL,
            formula_class VARCHAR(64) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY formula_key (formula_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('formula_versions')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            formula_id BIGINT UNSIGNED NOT NULL,
            version_key VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL,
            change_summary TEXT NOT NULL,
            rationale TEXT NOT NULL,
            fit_method VARCHAR(64) NOT NULL,
            feature_set_id BIGINT UNSIGNED NULL,
            source_code_ref VARCHAR(128) NOT NULL,
            benchmark_version_key VARCHAR(64) NULL,
            expected_effect TEXT NOT NULL,
            known_tradeoffs TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            approved_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY version_key (version_key),
            KEY formula_status (formula_id, status, created_at)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('formula_market_coverage')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            formula_version_id BIGINT UNSIGNED NOT NULL,
            market_type_id BIGINT UNSIGNED NOT NULL,
            coverage_role VARCHAR(32) NOT NULL,
            support_status VARCHAR(32) NOT NULL,
            valid_from_utc DATETIME NOT NULL,
            valid_to_utc DATETIME NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY formula_market_role (formula_version_id, market_type_id, coverage_role, valid_from_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('formula_runs')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_key VARCHAR(96) NOT NULL,
            formula_version_id BIGINT UNSIGNED NOT NULL,
            run_type VARCHAR(32) NOT NULL,
            run_status VARCHAR(32) NOT NULL,
            triggered_at_utc DATETIME NOT NULL,
            completed_at_utc DATETIME NULL,
            code_ref VARCHAR(128) NOT NULL,
            config_hash VARCHAR(128) NOT NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY run_key (run_key),
            KEY formula_time (formula_version_id, triggered_at_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('projections')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            projection_key VARCHAR(128) NOT NULL,
            formula_run_id BIGINT UNSIGNED NOT NULL,
            formula_version_id BIGINT UNSIGNED NOT NULL,
            event_id BIGINT UNSIGNED NOT NULL,
            market_instance_id BIGINT UNSIGNED NULL,
            selection_id BIGINT UNSIGNED NULL,
            prepared_input_id BIGINT UNSIGNED NULL,
            projected_at_utc DATETIME NOT NULL,
            output_family VARCHAR(64) NOT NULL,
            output_label VARCHAR(96) NOT NULL,
            fair_probability DECIMAL(12,6) NULL,
            fair_odds_american INT NULL,
            fair_odds_decimal DECIMAL(12,6) NULL,
            fair_line DECIMAL(12,4) NULL,
            point_estimate DECIMAL(12,4) NULL,
            distribution_payload LONGTEXT NULL,
            confidence_band VARCHAR(32) NOT NULL,
            stability_score DECIMAL(12,6) NULL,
            data_quality_score DECIMAL(12,6) NULL,
            release_decision VARCHAR(32) NOT NULL,
            release_reason VARCHAR(190) NULL,
            top_drivers LONGTEXT NULL,
            omissions LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY projection_key (projection_key),
            KEY event_time (event_id, projected_at_utc),
            KEY market_time (market_instance_id, projected_at_utc),
            KEY selection_time (selection_id, projected_at_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('release_rules')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            rule_key VARCHAR(64) NOT NULL,
            rule_name VARCHAR(190) NOT NULL,
            thresholds_json LONGTEXT NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY rule_key (rule_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('release_audits')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            projection_id BIGINT UNSIGNED NOT NULL,
            release_rule_id BIGINT UNSIGNED NOT NULL,
            audit_time_utc DATETIME NOT NULL,
            passed TINYINT(1) NOT NULL DEFAULT 0,
            failure_codes LONGTEXT NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY projection_time (projection_id, audit_time_utc)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('job_locks')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            job_key VARCHAR(96) NOT NULL,
            runner_id VARCHAR(96) NOT NULL,
            locked_at_utc DATETIME NOT NULL,
            expires_at_utc DATETIME NOT NULL,
            heartbeat_at_utc DATETIME NOT NULL,
            status VARCHAR(32) NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY job_key (job_key)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('run_logs')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            log_level VARCHAR(16) NOT NULL,
            context_key VARCHAR(96) NOT NULL,
            message TEXT NOT NULL,
            details LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY context_time (context_key, created_at),
            KEY level_time (log_level, created_at)
        ) $collate;";

        $tables[] = "CREATE TABLE {$this->table('system_state')} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            state_key VARCHAR(96) NOT NULL,
            state_value LONGTEXT NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY state_key (state_key)
        ) $collate;";

        return $tables;
    }

    private function seed_reference_rows(): void {
        global $wpdb;
        $now = current_time('mysql', true);

        $wpdb->replace($this->table('providers'), [
            'provider_key'  => 'draftkings_sportsbook',
            'provider_type' => 'sportsbook',
            'provider_name' => 'DraftKings Sportsbook',
            'is_active'     => 1,
            'created_at'    => $now,
            'updated_at'    => $now,
        ]);

        $wpdb->replace($this->table('providers'), [
            'provider_key'  => 'mlb_official',
            'provider_type' => 'results',
            'provider_name' => 'MLB Official',
            'is_active'     => 1,
            'created_at'    => $now,
            'updated_at'    => $now,
        ]);

        $wpdb->replace($this->table('providers'), [
            'provider_key'  => 'weather_official',
            'provider_type' => 'weather',
            'provider_name' => 'NOAA / NWS',
            'is_active'     => 1,
            'created_at'    => $now,
            'updated_at'    => $now,
        ]);

        $wpdb->replace($this->table('sports'), [
            'sport_key'   => 'baseball',
            'sport_name'  => 'Baseball',
            'is_active'   => 1,
            'created_at'  => $now,
        ]);

        $sport_id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$this->table('sports')} WHERE sport_key = %s",
            'baseball'
        ));

        $wpdb->replace($this->table('leagues'), [
            'sport_id'            => $sport_id,
            'league_key'          => 'mlb',
            'league_name'         => 'Major League Baseball',
            'season_type_default' => 'regular',
            'is_active'           => 1,
            'created_at'          => $now,
            'updated_at'          => $now,
        ]);

        $league_id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$this->table('leagues')} WHERE league_key = %s",
            'mlb'
        ));

        $team_rows = [
            [
                'team_key' => 'mlb_nyy_validation_seed',
                'team_name' => 'New York Yankees',
                'team_abbr' => 'NYY',
                'city_name' => 'New York',
            ],
            [
                'team_key' => 'mlb_bos_validation_seed',
                'team_name' => 'Boston Red Sox',
                'team_abbr' => 'BOS',
                'city_name' => 'Boston',
            ],
        ];

        foreach ($team_rows as $team_row) {
            $wpdb->replace($this->table('teams'), [
                'league_id' => $league_id,
                'team_key' => $team_row['team_key'],
                'team_name' => $team_row['team_name'],
                'team_abbr' => $team_row['team_abbr'],
                'city_name' => $team_row['city_name'],
                'valid_from' => '2026-01-01',
                'valid_to' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $settlement_rows = [
            [
                'settlement_rule_key' => 'mlb_moneyline_full_game',
                'rule_name'           => 'MLB Full Game Moneyline',
                'applies_to'          => 'game.moneyline.full_game',
                'push_logic'          => 'No push; suspended/canceled rules apply.',
                'void_logic'          => 'Void if official result unavailable or provider voids market.',
                'official_source_priority' => wp_json_encode(['mlb_official']),
            ],
            [
                'settlement_rule_key' => 'mlb_run_line_full_game',
                'rule_name'           => 'MLB Full Game Run Line',
                'applies_to'          => 'game.run_line.full_game',
                'push_logic'          => 'Push if margin equals listed integer line where applicable.',
                'void_logic'          => 'Void if official result unavailable or provider voids market.',
                'official_source_priority' => wp_json_encode(['mlb_official']),
            ],
            [
                'settlement_rule_key' => 'mlb_total_runs_full_game',
                'rule_name'           => 'MLB Full Game Total Runs',
                'applies_to'          => 'game.total.full_game',
                'push_logic'          => 'Push on integer total if exact.',
                'void_logic'          => 'Void if official result unavailable or provider voids market.',
                'official_source_priority' => wp_json_encode(['mlb_official']),
            ],
            [
                'settlement_rule_key' => 'mlb_team_total_full_game',
                'rule_name'           => 'MLB Full Game Team Total',
                'applies_to'          => 'team.total.full_game',
                'push_logic'          => 'Push on integer total if exact.',
                'void_logic'          => 'Void if official result unavailable or provider voids market.',
                'official_source_priority' => wp_json_encode(['mlb_official']),
            ],
        ];

        foreach ($settlement_rows as $row) {
            $wpdb->replace($this->table('settlement_rules'), array_merge($row, [
                'is_active'  => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ]));
        }

        $market_types = [
            ['mlb_game_moneyline_full_game', 'game', 'event', null, 'full_game', 'binary', 'moneyline', 'derived', null, 'mlb_moneyline_full_game', 'production', 0],
            ['mlb_game_run_line_full_game', 'game', 'event', null, 'full_game', 'line', 'run_line', 'derived', 'run_margin', 'mlb_run_line_full_game', 'production', 1],
            ['mlb_game_total_full_game', 'game', 'event', null, 'full_game', 'line', 'total', 'derived', 'total_runs', 'mlb_total_runs_full_game', 'production', 1],
            ['mlb_team_total_full_game', 'team', 'team', 'runs', 'full_game', 'line', 'team_total', 'derived', 'team_runs', 'mlb_team_total_full_game', 'production', 1],
        ];

        foreach ($market_types as $type) {
            $wpdb->replace($this->table('market_types'), [
                'market_type_key' => $type[0],
                'sport_key' => 'baseball',
                'league_key' => 'mlb',
                'market_family' => $type[1],
                'subject_type' => $type[2],
                'stat_type' => $type[3],
                'segment_type' => $type[4],
                'outcome_type' => $type[5],
                'line_type' => $type[6],
                'pricing_method' => $type[7],
                'parent_distribution_type' => $type[8],
                'settlement_rule_key' => $type[9],
                'support_tier' => $type[10],
                'push_allowed' => $type[11],
                'voidable' => 1,
                'is_active' => 1,
                'notes' => 'Seeded Phase 1 market type',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $feature_sets = [
            ['phase1_game_environment', 'Phase 1 Game Environment', 'Features for F001-F004 game and team run environment'],
            ['phase1_hitter_opportunity', 'Phase 1 Hitter Opportunity', 'Features for F005 hitter start / slot / PA opportunity'],
            ['phase1_pitcher_opportunity', 'Phase 1 Pitcher Opportunity', 'Features for F007 pitcher start / pitch count / BF / outs opportunity'],
        ];
        foreach ($feature_sets as $feature_set) {
            $wpdb->replace($this->table('feature_sets'), [
                'feature_set_key' => $feature_set[0],
                'feature_set_name' => $feature_set[1],
                'description' => $feature_set[2],
                'source_code_ref' => 'plugin:0.1.0',
                'is_active' => 1,
                'created_at' => $now,
            ]);
        }

        $formulas = [
            ['F001', 'F001_v1_game_win_run_environment', 'Jointly estimate home win probability and run environment.', 'event', 'probability,line', 'rule_based'],
            ['F002', 'F002_v1_run_margin_distribution', 'Estimate run margin distribution from parent team means.', 'event', 'distribution', 'rule_based'],
            ['F003', 'F003_v1_total_runs_distribution', 'Estimate total runs distribution from parent team means.', 'event', 'distribution', 'rule_based'],
            ['F004', 'F004_v1_team_total_distribution', 'Estimate team total distributions.', 'team', 'distribution', 'rule_based'],
            ['F005', 'F005_v1_hitter_opportunity_distribution', 'Estimate hitter start probability, slot band, and PA.', 'player', 'distribution', 'rule_based'],
            ['F007', 'F007_v1_pitcher_opportunity_distribution', 'Estimate pitcher start probability, pitch count, BF, and outs.', 'player', 'distribution', 'rule_based'],
        ];

        foreach ($formulas as $formula) {
            $wpdb->replace($this->table('formulas'), [
                'formula_key' => $formula[0],
                'formula_name' => $formula[1],
                'objective' => $formula[2],
                'prediction_unit' => $formula[3],
                'output_type' => $formula[4],
                'formula_class' => $formula[5],
                'is_active' => 1,
                'created_at' => $now,
            ]);
        }

        $version_defs = [
            ['F001', 'F001_v1', 'phase1_game_environment'],
            ['F002', 'F002_v1', 'phase1_game_environment'],
            ['F003', 'F003_v1', 'phase1_game_environment'],
            ['F004', 'F004_v1', 'phase1_game_environment'],
            ['F005', 'F005_v1', 'phase1_hitter_opportunity'],
            ['F007', 'F007_v1', 'phase1_pitcher_opportunity'],
        ];

        foreach ($version_defs as $version_def) {
            $formula_id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('formulas')} WHERE formula_key = %s",
                $version_def[0]
            ));
            $feature_set_id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('feature_sets')} WHERE feature_set_key = %s",
                $version_def[2]
            ));
            $wpdb->replace($this->table('formula_versions'), [
                'formula_id' => $formula_id,
                'version_key' => $version_def[1],
                'status' => 'approved',
                'change_summary' => 'Initial Phase 1 approved version.',
                'rationale' => 'Phase 1 live core projection engine.',
                'fit_method' => 'hand_set_phase1',
                'feature_set_id' => $feature_set_id,
                'source_code_ref' => 'plugin:0.1.0',
                'benchmark_version_key' => null,
                'expected_effect' => 'Enable initial public game-level and opportunity projections.',
                'known_tradeoffs' => 'Deterministic baseline with provisional weights.',
                'created_at' => $now,
                'approved_at' => $now,
            ]);
        }

        $this->seed_formula_market_coverage($now);

        $wpdb->replace($this->table('release_rules'), [
            'rule_key' => 'phase1_release_v1',
            'rule_name' => 'Phase 1 Release Rules',
            'thresholds_json' => wp_json_encode([
                'min_data_quality' => 0.60,
                'min_stability' => 0.50,
                'max_staleness_minutes' => 30,
                'allow_unconfirmed_lineup' => true,
                'allow_unconfirmed_starter' => false,
            ]),
            'is_active' => 1,
            'created_at' => $now,
        ]);
    }

    private function seed_formula_market_coverage(string $created_at): void {
        global $wpdb;

        $coverage_rows = [
            ['F001_v1', 'mlb_game_moneyline_full_game', 'publish'],
            ['F002_v1', 'mlb_game_run_line_full_game', 'publish'],
            ['F003_v1', 'mlb_game_total_full_game', 'publish'],
            ['F004_v1', 'mlb_team_total_full_game', 'publish'],
        ];

        foreach ($coverage_rows as $coverage_row) {
            $formula_version_id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('formula_versions')} WHERE version_key = %s",
                $coverage_row[0]
            ));
            $market_type_id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$this->table('market_types')} WHERE market_type_key = %s",
                $coverage_row[1]
            ));

            if ($formula_version_id <= 0) {
                throw new RuntimeException('Missing formula_version for coverage seed: ' . $coverage_row[0]);
            }

            if ($market_type_id <= 0) {
                throw new RuntimeException('Missing market_type for coverage seed: ' . $coverage_row[1]);
            }

            $existing_id = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT id
                 FROM {$this->table('formula_market_coverage')}
                 WHERE formula_version_id = %d
                   AND market_type_id = %d
                   AND coverage_role = %s
                 ORDER BY id ASC
                 LIMIT 1",
                $formula_version_id,
                $market_type_id,
                $coverage_row[2]
            ));

            $payload = [
                'formula_version_id' => $formula_version_id,
                'market_type_id' => $market_type_id,
                'coverage_role' => $coverage_row[2],
                'support_status' => 'approved',
                'valid_from_utc' => self::PHASE1_COVERAGE_VALID_FROM,
                'valid_to_utc' => null,
                'notes' => 'Phase 1 approved market coverage',
                'created_at' => $created_at,
            ];

            if ($existing_id > 0) {
                $result = $wpdb->update($this->table('formula_market_coverage'), $payload, ['id' => $existing_id]);
                if ($result === false) {
                    throw new RuntimeException('Failed to update formula_market_coverage row: ' . $wpdb->last_error);
                }
                continue;
            }

            $result = $wpdb->insert($this->table('formula_market_coverage'), $payload, ['%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s']);
            if ($result === false) {
                throw new RuntimeException('Failed to insert formula_market_coverage row: ' . $wpdb->last_error);
            }
        }
    }
}
