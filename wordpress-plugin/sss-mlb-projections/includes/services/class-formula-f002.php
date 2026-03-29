<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F002 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $parent): array {
        $margin = (float) ($parent['expected_run_margin'] ?? 0.0);
        $p_cover_minus_15 = 1 / (1 + exp(-(($margin - 1.5) * 0.9)));
        $p_cover_plus_15 = 1 - $p_cover_minus_15;

        return [
            'mean_margin' => round($margin, 3),
            'run_line_home_minus_1_5_prob' => round($p_cover_minus_15, 6),
            'run_line_away_plus_1_5_prob' => round($p_cover_plus_15, 6),
            'distribution_payload' => [
                'type' => 'approx_margin',
                'mean' => round($margin, 3),
                'std_dev' => 2.95,
            ],
        ];
    }
}
