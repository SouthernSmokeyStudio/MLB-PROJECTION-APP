<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F007 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $features): array {
        $start_logit = 0.2
            + ($features['recent_start_rate'] ?? 0.5)
            + (($features['injury_clearance'] ?? 1.0) - 1.0)
            + (($features['rotation_status'] ?? 1.0) - 0.5);

        $p_start = 1 / (1 + exp(-$start_logit));
        $expected_pitch_count = max(45.0, ($features['recent_pitch_count'] ?? 85) + ((($features['days_rest'] ?? 5) - 5) * 2) + (($features['leash_score'] ?? 0.6) * 8) - (($features['matchup_length_penalty'] ?? 0.0) * 8));
        $expected_bf = max(12.0, 8.5 + ($expected_pitch_count / 4.2));
        $expected_outs = max(6.0, ($expected_bf * 0.68));

        return [
            'p_start' => round($p_start, 6),
            'expected_pitch_count' => round($expected_pitch_count, 3),
            'expected_batters_faced' => round($expected_bf, 3),
            'expected_outs_recorded' => round($expected_outs, 3),
            'distribution_payload' => [
                'type' => 'pitcher_opportunity',
                'pitch_count_mean' => round($expected_pitch_count, 3),
                'bf_mean' => round($expected_bf, 3),
                'outs_mean' => round($expected_outs, 3),
            ],
        ];
    }
}
