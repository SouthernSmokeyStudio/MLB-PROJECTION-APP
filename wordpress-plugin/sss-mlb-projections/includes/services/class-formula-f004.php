<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F004 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $parent): array {
        $mu_home = (float) ($parent['mu_home_runs'] ?? 4.4);
        $mu_away = (float) ($parent['mu_away_runs'] ?? 4.1);

        return [
            'home_team_total_mean' => round($mu_home, 3),
            'away_team_total_mean' => round($mu_away, 3),
            'home_team_over_4_5_prob' => round(1 / (1 + exp(-(($mu_home - 4.5) * 0.95))), 6),
            'away_team_over_4_5_prob' => round(1 / (1 + exp(-(($mu_away - 4.5) * 0.95))), 6),
        ];
    }
}
