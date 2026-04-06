<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_REST_Controller_Projections {
    public function __construct(private SSS_MLB_Projections_Repository $projections) {}

    public function register_routes(): void {
        register_rest_route('sss-mlb/v1', '/slate/(?P<date>\d{4}-\d{2}-\d{2})', [
            'methods' => 'GET',
            'callback' => [$this, 'get_slate'],
            'permission_callback' => '__return_true',
        ]);
    }

    public function get_slate(WP_REST_Request $request): WP_REST_Response {
        $date = (string) $request['date'];
        $slate = $this->projections->get_publish_safe_slate($date);
        return new WP_REST_Response($slate, 200);
    }
}
