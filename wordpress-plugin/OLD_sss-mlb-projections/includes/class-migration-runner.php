<?php
if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/repositories/class-base-repository.php';
require_once __DIR__ . '/repositories/class-run-logs-repository.php';
require_once __DIR__ . '/repositories/class-system-state-repository.php';
require_once __DIR__ . '/support/class-logger.php';

final class SSS_MLB_Migration_Runner {
    private SSS_MLB_System_State_Repository $system_state;
    private SSS_MLB_Logger $logger;

    public function __construct(private SSS_MLB_Schema_Manager $schema_manager) {
        $logs = new SSS_MLB_Run_Logs_Repository();
        $this->system_state = new SSS_MLB_System_State_Repository();
        $this->logger = new SSS_MLB_Logger($logs);
    }

    public function install_or_upgrade(): void {
        $started_at = current_time('mysql', true);

        try {
            $report = $this->schema_manager->install_or_upgrade();
            $state = [
                'installed' => true,
                'status' => 'ready',
                'action' => $report['action'],
                'plugin_version' => $report['plugin_version'],
                'schema_version' => $report['schema_version'],
                'ran_at_utc' => $report['ran_at_utc'],
            ];

            $this->system_state->set('plugin_install_state', $state);
            $this->system_state->set('schema_version_state', [
                'schema_version' => $report['schema_version'],
                'plugin_version' => $report['plugin_version'],
                'previous_schema_version' => $report['previous_schema_version'],
                'previous_plugin_version' => $report['previous_plugin_version'],
                'updated_at_utc' => $report['ran_at_utc'],
            ]);
            $this->system_state->set('migration_last_execution', [
                'status' => 'completed',
                'action' => $report['action'],
                'started_at_utc' => $started_at,
                'completed_at_utc' => $report['ran_at_utc'],
                'schema_version' => $report['schema_version'],
                'plugin_version' => $report['plugin_version'],
            ]);
            $this->system_state->append_event('migration_execution_history', [
                'status' => 'completed',
                'action' => $report['action'],
                'started_at_utc' => $started_at,
                'completed_at_utc' => $report['ran_at_utc'],
                'schema_version' => $report['schema_version'],
                'plugin_version' => $report['plugin_version'],
            ]);

            if (!$this->system_state->get('plugin_install_state')) {
                throw new RuntimeException('plugin_install_state was not persisted.');
            }

            if (!$this->system_state->get('schema_version_state')) {
                throw new RuntimeException('schema_version_state was not persisted.');
            }

            $this->logger->info('migration_runner', 'Schema install or upgrade completed.', $report);
        } catch (Throwable $throwable) {
            $failure = [
                'status' => 'failed',
                'action' => 'install_or_upgrade',
                'started_at_utc' => $started_at,
                'failed_at_utc' => current_time('mysql', true),
                'error' => $throwable->getMessage(),
            ];

            try {
                $this->system_state->set('plugin_install_state', [
                    'installed' => false,
                    'status' => 'failed',
                    'action' => 'install_or_upgrade',
                    'last_error' => $throwable->getMessage(),
                    'updated_at_utc' => $failure['failed_at_utc'],
                ]);
                $this->system_state->set('migration_last_execution', $failure);
                $this->system_state->append_event('migration_execution_history', $failure);
                $this->logger->error('migration_runner', 'Schema install or upgrade failed.', $failure);
            } catch (Throwable) {
                // The schema may have failed before operational tables existed.
            }

            throw $throwable;
        }
    }
}
