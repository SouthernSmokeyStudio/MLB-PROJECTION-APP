<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F001 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $features): array {
        $x_home = 1.15
            + ($features['home_field_effect'] ?? 0.0)
            + ($features['home_offense'] ?? 1.0)
            - ($features['away_starter_quality'] ?? 0.0)
            - ($features['away_bullpen_quality'] ?? 0.0)
            + (($features['park_run_factor'] ?? 1.0) - 1.0)
            + (($features['weather_factor'] ?? 1.0) - 1.0);

        $x_away = 1.05
            + ($features['away_offense'] ?? 1.0)
            - ($features['home_starter_quality'] ?? 0.0)
            - ($features['home_bullpen_quality'] ?? 0.0)
            + (($features['park_run_factor'] ?? 1.0) - 1.0)
            + (($features['weather_factor'] ?? 1.0) - 1.0);

        $mu_home = max(2.2, min(8.5, exp(log(max(0.1, $x_home)))));
        $mu_away = max(2.1, min(8.2, exp(log(max(0.1, $x_away)))));
        $margin = $mu_home - $mu_away;
        $p_home = 1 / (1 + exp(-($margin * 0.65)));

        return [
            'mu_home_runs' => round($mu_home, 3),
            'mu_away_runs' => round($mu_away, 3),
            'lambda_game_runs' => round($mu_home + $mu_away, 3),
            'expected_run_margin' => round($margin, 3),
            'p_home_win' => round($p_home, 6),
            'p_away_win' => round(1 - $p_home, 6),
            'data_quality_score' => (($features['starter_confirmed_home'] ?? false) && ($features['starter_confirmed_away'] ?? false)) ? 0.82 : 0.58,
            'stability_score' => (($features['lineup_confirmed_home'] ?? false) && ($features['lineup_confirmed_away'] ?? false)) ? 0.78 : 0.60,
        ];
    }
}
