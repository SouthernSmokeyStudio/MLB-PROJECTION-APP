<?php
if (!defined('ABSPATH')) {
    exit;
}

final class SSS_MLB_WP_CLI_Command {
    public function __construct(private SSS_MLB_Run_Orchestrator $orchestrator) {}

    public function __invoke(array $args, array $assoc_args): void {
        $job = $assoc_args['job'] ?? 'full';
        if ($job === 'full') {
            try {
                $result = $this->orchestrator->run_full_projection_batch();
            } catch (Throwable $throwable) {
                \WP_CLI::error('Phase 1 full projection batch failed: ' . $throwable->getMessage());
                return;
            }

            if (($result['status'] ?? null) === 'success' && (int) ($result['formula_run_count'] ?? 0) > 0) {
                \WP_CLI::success(sprintf(
                    'Phase 1 full projection batch completed. event_count=%d formula_run_count=%d projection_count=%d release_audit_count=%d',
                    (int) ($result['event_count'] ?? 0),
                    (int) ($result['formula_run_count'] ?? 0),
                    (int) ($result['projection_count'] ?? 0),
                    (int) ($result['release_audit_count'] ?? 0)
                ));
                return;
            }

            if (($result['status'] ?? null) === 'skipped') {
                \WP_CLI::error('Phase 1 full projection batch skipped because another runner owns the lock.');
                return;
            }

            \WP_CLI::error('Phase 1 full projection batch did not create any formula run rows.');
            return;
        }

        if ($job === 'ingest') {
            try {
                $result = $this->orchestrator->ingest_core_markets();
            } catch (Throwable $throwable) {
                \WP_CLI::error('Phase 1 ingest batch failed: ' . $throwable->getMessage());
                return;
            }

            if (($result['status'] ?? null) === 'success' && !empty($result['event_id'])) {
                \WP_CLI::success(sprintf(
                    'Phase 1 ingest batch completed. event_id=%d market_instance_count=%d prepared_input_id=%d',
                    (int) $result['event_id'],
                    (int) ($result['market_instance_count'] ?? 0),
                    (int) ($result['prepared_input_id'] ?? 0)
                ));
                return;
            }

            if (($result['status'] ?? null) === 'skipped') {
                \WP_CLI::error('Phase 1 ingest batch skipped because another runner owns the lock.');
                return;
            }

            \WP_CLI::error('Phase 1 ingest batch did not create a validation event row.');
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
