<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Config {
    public static function get(string $key, mixed $default = null): mixed {
        $config = [
            'max_event_staleness_minutes' => 30,
            'plugin_version' => SSS_MLB_PLUGIN_VERSION,
            'schema_version' => SSS_MLB_SCHEMA_VERSION,
            'active_formula_bundle' => SSS_MLB_ACTIVE_FORMULA_BUNDLE,
        ];

        return $config[$key] ?? $default;
    }
}
