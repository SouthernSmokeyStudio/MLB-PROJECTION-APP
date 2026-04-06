<?php
if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-schema-manager.php';
require_once __DIR__ . '/class-migration-runner.php';
require_once __DIR__ . '/support/class-config.php';
require_once __DIR__ . '/support/class-time.php';
require_once __DIR__ . '/support/class-validator.php';
require_once __DIR__ . '/repositories/class-base-repository.php';
require_once __DIR__ . '/repositories/class-job-locks-repository.php';
require_once __DIR__ . '/repositories/class-formula-registry-repository.php';
require_once __DIR__ . '/repositories/class-events-repository.php';
require_once __DIR__ . '/repositories/class-markets-repository.php';
require_once __DIR__ . '/repositories/class-prepared-inputs-repository.php';
require_once __DIR__ . '/repositories/class-projections-repository.php';
require_once __DIR__ . '/repositories/class-run-logs-repository.php';
require_once __DIR__ . '/repositories/class-system-state-repository.php';
require_once __DIR__ . '/support/class-logger.php';
require_once __DIR__ . '/services/class-feature-builder.php';
require_once __DIR__ . '/services/class-formula-f001.php';
require_once __DIR__ . '/services/class-formula-f002.php';
require_once __DIR__ . '/services/class-formula-f003.php';
require_once __DIR__ . '/services/class-formula-f004.php';
require_once __DIR__ . '/services/class-formula-f005.php';
require_once __DIR__ . '/services/class-formula-f007.php';
require_once __DIR__ . '/services/class-release-manager.php';
require_once __DIR__ . '/services/class-run-orchestrator.php';
require_once __DIR__ . '/admin/class-admin-menu.php';
require_once __DIR__ . '/api/class-rest-controller-projections.php';
require_once __DIR__ . '/api/class-rest-controller-runs.php';

final class SSS_MLB_Plugin {
    public function run(): void {
        add_action('plugins_loaded', [$this, 'load']);
    }

    public function load(): void {
        $locks = new SSS_MLB_Job_Locks_Repository();
        $events = new SSS_MLB_Events_Repository();
        $markets = new SSS_MLB_Markets_Repository();
        $prepared_inputs = new SSS_MLB_Prepared_Inputs_Repository();
        $formula_registry = new SSS_MLB_Formula_Registry_Repository();
        $projections = new SSS_MLB_Projections_Repository();
        $run_logs = new SSS_MLB_Run_Logs_Repository();
        $system_state = new SSS_MLB_System_State_Repository();
        $logger = new SSS_MLB_Logger($run_logs);
        $validator = new SSS_MLB_Validator();

        $feature_builder = new SSS_MLB_Feature_Builder($events, $markets, $validator, $logger);
        $formula_f001 = new SSS_MLB_Formula_F001($logger);
        $formula_f002 = new SSS_MLB_Formula_F002($logger);
        $formula_f003 = new SSS_MLB_Formula_F003($logger);
        $formula_f004 = new SSS_MLB_Formula_F004($logger);
        $formula_f005 = new SSS_MLB_Formula_F005($logger);
        $formula_f007 = new SSS_MLB_Formula_F007($logger);
        $release_manager = new SSS_MLB_Release_Manager($formula_registry, $markets, $validator, $logger);

        $orchestrator = new SSS_MLB_Run_Orchestrator(
            $locks,
            $formula_registry,
            $events,
            $markets,
            $projections,
            $prepared_inputs,
            $feature_builder,
            $formula_f001,
            $formula_f002,
            $formula_f003,
            $formula_f004,
            $formula_f005,
            $formula_f007,
            $release_manager,
            $system_state,
            $logger
        );

        $admin_menu = new SSS_MLB_Admin_Menu();
        $public_api = new SSS_MLB_REST_Controller_Projections($projections);
        $run_api = new SSS_MLB_REST_Controller_Runs($orchestrator);

        add_action('admin_menu', [$admin_menu, 'register']);
        add_action('rest_api_init', [$public_api, 'register_routes']);
        add_action('rest_api_init', [$run_api, 'register_routes']);

        add_action('sss_mlb_run_full_projection_batch', [$orchestrator, 'run_full_projection_batch']);
        add_action('sss_mlb_ingest_core_markets', [$orchestrator, 'ingest_core_markets']);
        add_action('sss_mlb_archive_results', [$orchestrator, 'archive_results']);

        if (defined('WP_CLI') && WP_CLI) {
            require_once __DIR__ . '/support/class-wp-cli-command.php';
            \WP_CLI::add_command('sss-mlb run', new SSS_MLB_WP_CLI_Command($orchestrator));
        }
    }
}
