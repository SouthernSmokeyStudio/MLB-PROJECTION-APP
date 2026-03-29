<?php
if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/class-schema-manager.php';
require_once __DIR__ . '/class-migration-runner.php';

final class SSS_MLB_Activator {
    public static function activate(): void {
        $schema = new SSS_MLB_Schema_Manager();
        $runner = new SSS_MLB_Migration_Runner($schema);
        $runner->install_or_upgrade();
        self::register_cron();
        flush_rewrite_rules();
    }

    private static function register_cron(): void {
        if (!wp_next_scheduled('sss_mlb_ingest_core_markets')) {
            wp_schedule_event(time() + 120, 'five_minutes', 'sss_mlb_ingest_core_markets');
        }

        if (!wp_next_scheduled('sss_mlb_run_full_projection_batch')) {
            wp_schedule_event(time() + 300, 'fifteen_minutes', 'sss_mlb_run_full_projection_batch');
        }

        if (!wp_next_scheduled('sss_mlb_archive_results')) {
            wp_schedule_event(time() + 900, 'hourly', 'sss_mlb_archive_results');
        }
    }
}

add_filter('cron_schedules', static function (array $schedules): array {
    $schedules['five_minutes'] = [
        'interval' => 300,
        'display'  => __('Every Five Minutes', 'sss-mlb'),
    ];

    $schedules['fifteen_minutes'] = [
        'interval' => 900,
        'display'  => __('Every Fifteen Minutes', 'sss-mlb'),
    ];

    return $schedules;
});
