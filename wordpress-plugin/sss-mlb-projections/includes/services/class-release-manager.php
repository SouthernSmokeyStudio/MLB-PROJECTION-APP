<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Release_Manager {
    public function __construct(
        private SSS_MLB_Formula_Registry_Repository $formula_registry,
        private SSS_MLB_Markets_Repository $markets,
        private SSS_MLB_Validator $validator,
        private SSS_MLB_Logger $logger
    ) {}

    public function evaluate(array $candidate): array {
        $errors = $this->validator->validate_release_candidate($candidate);
        $rule = $this->formula_registry->get_active_release_rule();
        $thresholds = $rule ? json_decode((string) $rule['thresholds_json'], true) : [];

        if (($candidate['stale_minutes'] ?? 999) > ($thresholds['max_staleness_minutes'] ?? 30)) {
            $errors[] = 'stale_data';
        }

        if (($candidate['data_quality_score'] ?? 0.0) < ($thresholds['min_data_quality'] ?? 0.60)) {
            $errors[] = 'data_quality_low';
        }

        if (($candidate['stability_score'] ?? 0.0) < ($thresholds['min_stability'] ?? 0.50)) {
            $errors[] = 'stability_low';
        }

        if (!($candidate['starter_confirmed'] ?? false)) {
            $errors[] = 'starter_unconfirmed';
        }

        $passed = empty($errors);

        return [
            'passed' => $passed,
            'release_decision' => $passed ? 'publish' : 'block',
            'failure_codes' => $errors,
            'release_rule_id' => $rule['id'] ?? 0,
        ];
    }
}
