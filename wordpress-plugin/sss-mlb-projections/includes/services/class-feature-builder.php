<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Feature_Builder {
    public function __construct(
        private SSS_MLB_Events_Repository $events,
        private SSS_MLB_Markets_Repository $markets,
        private SSS_MLB_Validator $validator,
        private SSS_MLB_Logger $logger
    ) {}

    public function build_game_features(array $event): array {
        return [
            'event_id' => (int) $event['id'],
            'home_offense' => 1.02,
            'away_offense' => 0.98,
            'home_starter_quality' => 0.12,
            'away_starter_quality' => 0.09,
            'home_bullpen_quality' => 0.05,
            'away_bullpen_quality' => 0.02,
            'park_run_factor' => 1.00,
            'weather_factor' => 1.00,
            'home_field_effect' => 0.07,
            'volatility_factor' => 0.04,
            'lineup_confirmed_home' => false,
            'lineup_confirmed_away' => false,
            'starter_confirmed_home' => true,
            'starter_confirmed_away' => true,
        ];
    }

    public function build_hitter_opportunity_features(array $event, int $player_id): array {
        return [
            'event_id' => (int) $event['id'],
            'player_id' => $player_id,
            'recent_start_rate' => 0.85,
            'injury_clearance' => 1.0,
            'platoon_advantage' => 0.1,
            'manager_pattern' => 0.55,
            'position_competition' => 0.2,
            'expected_slot' => 5,
            'team_run_environment' => 4.4,
        ];
    }

    public function build_pitcher_opportunity_features(array $event, int $player_id): array {
        return [
            'event_id' => (int) $event['id'],
            'player_id' => $player_id,
            'recent_start_rate' => 0.95,
            'injury_clearance' => 1.0,
            'rotation_status' => 1.0,
            'days_rest' => 5,
            'recent_pitch_count' => 92,
            'leash_score' => 0.72,
            'matchup_length_penalty' => 0.08,
        ];
    }
}
