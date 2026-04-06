<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_Time {
    public static function now_utc(): string {
        return gmdate('Y-m-d H:i:s');
    }

    public static function minutes_ago(int $minutes): string {
        return gmdate('Y-m-d H:i:s', time() - ($minutes * 60));
    }
}
