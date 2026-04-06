<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Admin_Menu {
    public function register(): void {
        add_menu_page(
            'SSS MLB',
            'SSS MLB',
            'manage_options',
            'sss-mlb-system',
            [$this, 'render_overview'],
            'dashicons-chart-area',
            58
        );
    }

    public function render_overview(): void {
        echo '<div class="wrap"><h1>SSS MLB Phase 1</h1>';
        echo '<p>Phase 1 plugin shell installed. Use WP-CLI or cron hooks to run batches.</p>';
        echo '<ul>';
        echo '<li>Core formulas: F001, F002, F003, F004, F005, F007</li>';
        echo '<li>Public scope: Schedule, Game Projections, Limited Player Opportunity, Limited Betting Core Markets</li>';
        echo '<li>Release scope: publish/block via Phase 1 hard gate rules</li>';
        echo '</ul></div>';
    }
}
