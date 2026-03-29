<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_F003 {
    public function __construct(private SSS_MLB_Logger $logger) {}

    public function run(array $parent): array {
        $total = (float) ($parent['lambda_game_runs'] ?? 8.5);
        $p_over_85 = 1 / (1 + exp(-(($total - 8.5) * 0.85)));

        return [
            'mean_total_runs' => round($total, 3),
            'total_over_8_5_prob' => round($p_over_85, 6),
            'total_under_8_5_prob' => round(1 - $p_over_85, 6),
            'distribution_payload' => [
                'type' => 'approx_total',
                'mean' => round($total, 3),
                'std_dev' => 3.10,
            ],
        ];
    }
}
