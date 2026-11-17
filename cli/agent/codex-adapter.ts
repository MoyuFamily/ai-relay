// ============================================================
// AI Relay CLI — Codex Agent Adapter
// ============================================================

import type { AgentAdapter, InstallOptions, InstallResult, DoctorResult, UninstallOptions, UninstallResult } from './adapter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class CodexAdapter implements AgentAdapter {
  id = 'codex' as const;
  label = 'Codex';

  async detect(): Promise<{ installed: boolean; configPath?: string }> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    return {
      installed: fs.existsSync(configPath),
      configPath: fs.existsSync(configPath) ? configPath : undefined,
    };
  }

  async install(options: InstallOptions): Promise<InstallResult> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    if (!fs.existsSync(configPath)) {
      return {
        success: false,
        message: 'Codex config not found. Install Codex first.',
      };
    }

    // Backup
    const backupPath = `${configPath}.backup.${Date.now()}`;
    if (!options.dryRun) {
      fs.copyFileSync(configPath, backupPath);
    }

    // Escape URL for TOML string (prevent injection)
    const escapedUrl = options.localRelayUrl
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    const snippet = `
[model_providers.ai-relay-local]
name = "AI Relay Local"
base_url = "${escapedUrl}/v1"
wire_api = "chat"
requires_openai_auth = true
`;

    if (options.dryRun) {
      return {
        success: true,
        configPath,
        message: `Would append to ${configPath}:\n${snippet}`,
      };
    }

    // Check if already installed
    const content = fs.readFileSync(configPath, 'utf-8');
    if (content.includes('[model_providers.ai-relay-local]')) {
      return {
        success: false,
        message: 'ai-relay-local provider already exists in config',
      };
    }

    fs.appendFileSync(configPath, snippet);

    return {
      success: true,
      configPath,
      message: `✅ Added ai-relay-local provider\n   Backup: ${backupPath}`,
    };
  }

  async doctor(): Promise<DoctorResult> {
    const detection = await this.detect();

    const checks: DoctorResult['checks'] = [
      {
        name: 'Codex installed',
        status: detection.installed ? 'pass' : 'fail',
        message: detection.installed ? 'Found config at ~/.codex/config.toml' : 'Codex config not found',
      },
    ];

    if (detection.installed && detection.configPath) {
      const content = fs.readFileSync(detection.configPath, 'utf-8');
      const hasProvider = content.includes('[model_providers.ai-relay-local]');

      checks.push({
        name: 'AI Relay provider configured',
        status: hasProvider ? 'pass' : 'warn',
        message: hasProvider ? 'ai-relay-local provider found in config' : 'Run "ai-relay agent install codex" first',
      });

      if (hasProvider) {
        const hasBaseUrl = content.includes('base_url = "http://127.0.0.1:3147/v1"');
        checks.push({
          name: 'Base URL points to local relay',
          status: hasBaseUrl ? 'pass' : 'warn',
          message: hasBaseUrl ? 'Correctly points to 127.0.0.1:3147' : 'Base URL may be incorrect',
        });
      }
    }

    return {
      ok: checks.every(c => c.status === 'pass'),
      checks,
    };
  }

  async uninstall(options?: UninstallOptions): Promise<UninstallResult> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    if (!fs.existsSync(configPath)) {
      throw new Error('Codex config not found');
    }

    const content = fs.readFileSync(configPath, 'utf-8');

    // Check if ai-relay-local section exists
    if (!content.includes('[model_providers.ai-relay-local]')) {
      return {
        success: false,
        message: 'ai-relay-local provider not found in config',
      };
    }

    // Remove ai-relay-local section only (preserve other user changes)
    const lines = content.split('\n');
    const filtered = [];
    let inSection = false;

    for (const line of lines) {
      if (line.trim() === '[model_providers.ai-relay-local]') {
        inSection = true;
        continue;
      }
      if (inSection && line.trim().startsWith('[')) {
        inSection = false;
      }
      if (!inSection) {
        filtered.push(line);
      }
    }

    const newContent = filtered.join('\n');

    if (options?.dryRun) {
      return {
        success: true,
        message: `Would remove ai-relay-local section from ${configPath}`,
      };
    }

    // Create backup before uninstall
    const backupPath = `${configPath}.backup.uninstall.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);

    // Write modified content
    fs.writeFileSync(configPath, newContent);

    return {
      success: true,
      message: `✅ Removed ai-relay-local provider\n   Backup: ${backupPath}`,
      backupPath,
    };
  }
}
