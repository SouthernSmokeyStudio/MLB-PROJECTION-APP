<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_REST_Controller_Runs {
    public function __construct(private SSS_MLB_Run_Orchestrator $orchestrator) {}

    public function register_routes(): void {
        register_rest_route('sss-mlb/v1', '/internal/run-batch', [
            'methods' => 'POST',
            'callback' => [$this, 'run_batch'],
            'permission_callback' => function (): bool {
                return current_user_can('manage_options');
            },
        ]);
    }

    public function run_batch(WP_REST_Request $request): WP_REST_Response {
        $this->orchestrator->run_full_projection_batch();
        return new WP_REST_Response(['status' => 'ok'], 200);
    }
}
