<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_WP_CLI_Command {
    public function __construct(private SSS_MLB_Run_Orchestrator $orchestrator) {}

    public function __invoke(array $args, array $assoc_args): void {
        $job = $assoc_args['job'] ?? 'full';
        if ($job === 'full') {
            $this->orchestrator->run_full_projection_batch();
            \WP_CLI::success('Phase 1 full projection batch completed.');
            return;
        }

        if ($job === 'ingest') {
            $this->orchestrator->ingest_core_markets();
            \WP_CLI::success('Phase 1 ingest batch completed.');
            return;
        }

        if ($job === 'results') {
            $this->orchestrator->archive_results();
            \WP_CLI::success('Phase 1 results archive completed.');
            return;
        }

        \WP_CLI::error('Unknown job. Use --job=full|ingest|results');
    }
}
