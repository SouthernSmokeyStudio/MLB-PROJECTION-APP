<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Validator {
    public function normalize_probability(float $value): float {
        return max(0.0001, min(0.9999, $value));
    }

    public function validate_release_candidate(array $candidate): array {
        $errors = [];

        if (empty($candidate['formula_version_key'])) {
            $errors[] = 'missing_formula_version';
        }

        if (($candidate['data_quality_score'] ?? 0) <= 0) {
            $errors[] = 'data_quality_missing';
        }

        if (empty($candidate['event_id'])) {
            $errors[] = 'missing_event_id';
        }

        return $errors;
    }

    public function must_be_one_of(string $value, array $allowed, string $error_key): void {
        if (!in_array($value, $allowed, true)) {
            throw new InvalidArgumentException($error_key);
        }
    }
}
