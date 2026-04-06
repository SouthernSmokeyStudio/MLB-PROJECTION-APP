<?php
/**
 * Plugin Name: SSS MLB Projections
 * Description: Southern Smokey Studio MLB Phase 1 projection engine shell.
 * Version: 0.1.0
 * Author: Southern Smokey Studio
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SSS_MLB_PLUGIN_VERSION', '0.1.0');
define('SSS_MLB_PLUGIN_FILE', __FILE__);
define('SSS_MLB_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SSS_MLB_PLUGIN_URL', plugin_dir_url(__FILE__));
define('SSS_MLB_SCHEMA_VERSION', '0.1.0');
define('SSS_MLB_ACTIVE_FORMULA_BUNDLE', 'phase1-core');

require_once SSS_MLB_PLUGIN_DIR . 'includes/class-plugin.php';
require_once SSS_MLB_PLUGIN_DIR . 'includes/class-activator.php';
require_once SSS_MLB_PLUGIN_DIR . 'includes/class-deactivator.php';

register_activation_hook(__FILE__, ['SSS_MLB_Activator', 'activate']);
register_deactivation_hook(__FILE__, ['SSS_MLB_Deactivator', 'deactivate']);

function sss_mlb_boot_plugin(): void {
    $plugin = new SSS_MLB_Plugin();
    $plugin->run();
}
sss_mlb_boot_plugin();
