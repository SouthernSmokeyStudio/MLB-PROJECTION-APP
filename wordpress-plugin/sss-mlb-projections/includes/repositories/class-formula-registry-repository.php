<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Formula_Registry_Repository extends SSS_MLB_Base_Repository {
    public function get_approved_version(string $formula_key): ?array {
        $formulas = $this->table('formulas');
        $versions = $this->table('formula_versions');

        $sql = "
            SELECT f.id AS formula_id, f.formula_key, f.formula_name, v.*
            FROM {$formulas} f
            INNER JOIN {$versions} v ON v.formula_id = f.id
            WHERE f.formula_key = %s
              AND v.status = 'approved'
            ORDER BY v.id DESC
            LIMIT 1
        ";

        $row = $this->wpdb->get_row($this->wpdb->prepare($sql, $formula_key), ARRAY_A);
        return is_array($row) ? $row : null;
    }

    public function get_active_release_rule(): ?array {
        $row = $this->wpdb->get_row(
            "SELECT * FROM {$this->table('release_rules')} WHERE is_active = 1 ORDER BY id DESC LIMIT 1",
            ARRAY_A
        );
        return is_array($row) ? $row : null;
    }
}
