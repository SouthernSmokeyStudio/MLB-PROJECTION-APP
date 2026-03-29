<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Deactivator {
    public static function deactivate(): void {
        wp_clear_scheduled_hook('sss_mlb_ingest_core_markets');
        wp_clear_scheduled_hook('sss_mlb_run_full_projection_batch');
        wp_clear_scheduled_hook('sss_mlb_archive_results');
        flush_rewrite_rules();
    }
}
