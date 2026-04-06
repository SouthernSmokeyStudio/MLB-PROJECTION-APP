<?php
if (!defined('ABSPATH')) {
    exit;
}

abstract class SSS_MLB_Base_Repository {
    protected wpdb $wpdb;
    protected string $prefix;

    public function __construct() {
        global $wpdb;
        $this->wpdb = $wpdb;
        $this->prefix = $wpdb->prefix . 'sss_mlb_';
    }

    protected function table(string $suffix): string {
        return $this->prefix . $suffix;
    }
}
