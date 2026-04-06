<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F005 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $features): array {
        $logit = -0.25
            + ($features['recent_start_rate'] ?? 0.5)
            + (($features['injury_clearance'] ?? 1.0) - 1.0)
            + ($features['platoon_advantage'] ?? 0.0)
            + (($features['manager_pattern'] ?? 0.5) - 0.5)
            - ($features['position_competition'] ?? 0.0);

        $p_start = 1 / (1 + exp(-$logit));
        $expected_slot = (int) ($features['expected_slot'] ?? 5);
        $slot_band_low = max(1, $expected_slot - 1);
        $slot_band_high = min(9, $expected_slot + 1);
        $expected_pa = 3.4 + max(0.0, 0.18 * ((10 - $expected_slot))) + (0.08 * (($features['team_run_environment'] ?? 4.2) - 4.2));

        return [
            'p_start' => round($p_start, 6),
            'slot_band_low' => $slot_band_low,
            'slot_band_high' => $slot_band_high,
            'expected_plate_appearances' => round($expected_pa, 3),
            'distribution_payload' => [
                'type' => 'plate_appearances',
                'mean' => round($expected_pa, 3),
                'low' => round(max(0, $expected_pa - 1.1), 3),
                'high' => round($expected_pa + 1.0, 3),
            ],
        ];
    }
}
