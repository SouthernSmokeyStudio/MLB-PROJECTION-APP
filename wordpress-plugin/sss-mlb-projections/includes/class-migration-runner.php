<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Migration_Runner {
    public function __construct(private SSS_MLB_Schema_Manager $schema_manager) {}

    public function install_or_upgrade(): void {
        $this->schema_manager->install_or_upgrade();
    }
}
