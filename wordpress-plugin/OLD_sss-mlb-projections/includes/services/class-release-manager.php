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
        $output_family = (string) ($candidate['output_family'] ?? '');
        $market_type_key = $candidate['market_type_key'] ?? null;
        $supported_output_families = ['game_projection', 'betting_projection', 'player_opportunity'];

        if (!in_array($output_family, $supported_output_families, true)) {
            $errors[] = 'unsupported_market_output_family';
        }

        if (($candidate['stale_minutes'] ?? 999) > ($thresholds['max_staleness_minutes'] ?? 30)) {
            $errors[] = 'stale_data';
        }

        if (($candidate['data_quality_score'] ?? 0.0) < ($thresholds['min_data_quality'] ?? 0.60)) {
            $errors[] = 'data_quality_low';
        }

        if (($candidate['stability_score'] ?? 0.0) < ($thresholds['min_stability'] ?? 0.50)) {
            $errors[] = 'stability_low';
        }

        if (!($candidate['formula_version_approved'] ?? false)) {
            $errors[] = 'formula_version_not_approved';
        }

        if (!($candidate['parent_distribution_ready'] ?? true)) {
            $errors[] = 'missing_required_parent_distribution';
        }

        if (($candidate['entity_mapping_status'] ?? 'mapped') !== 'mapped') {
            $errors[] = 'failed_entity_mapping';
        }

        if (!($candidate['required_inputs_complete'] ?? false)) {
            $errors[] = 'required_inputs_missing';
        }

        if ($output_family === 'betting_projection' && !$this->markets->is_supported_market_type_key($market_type_key)) {
            $errors[] = 'unsupported_market_output_family';
        }

        if ($output_family === 'betting_projection' && !$this->markets->market_type_has_settlement_rule($market_type_key)) {
            $errors[] = 'missing_settlement_rule';
        }

        if (
            !($thresholds['allow_unconfirmed_starter'] ?? false)
            && !($candidate['starter_confirmed'] ?? false)
        ) {
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
