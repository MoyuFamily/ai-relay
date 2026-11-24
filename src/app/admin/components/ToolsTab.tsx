'use client';

import React from 'react';
import RuntimeSettingsPanel from './RuntimeSettingsPanel';
import TempKeyGenerator from './TempKeyGenerator';
import ModelKeyTest from './ModelKeyTest';
import BackupRestore from './BackupRestore';
import StatsBackupRestore from './StatsBackupRestore';
import CcSwitchExport from './CcSwitchExport';

interface ToolsTabProps {
  apiKey: string;
  lang: 'zh' | 'en';
  t: any;
  providers: any[];
  onRefreshData?: () => Promise<void>;
}

export default function ToolsTab({ apiKey, lang, t, providers, onRefreshData }: ToolsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-select {
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg fill='none' height='24' stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><polyline points='6 9 12 15 18 9'/></svg>");
          background-repeat: no-repeat;
          background-position: right 0.5rem center;
          background-size: 1rem;
          padding-right: 2rem !important;
        }
      `}} />

      <RuntimeSettingsPanel
        apiKey={apiKey}
        lang={lang}
      />

      <TempKeyGenerator
        apiKey={apiKey}
        lang={lang}
        t={t}
      />

      <ModelKeyTest
        apiKey={apiKey}
        lang={lang}
        t={t}
        providers={providers}
        onRefreshData={onRefreshData}
      />

      <BackupRestore
        apiKey={apiKey}
        lang={lang}
        t={t}
        onRefreshData={onRefreshData}
      />

      <CcSwitchExport
        apiKey={apiKey}
        lang={lang}
        t={t}
      />

      <StatsBackupRestore
        apiKey={apiKey}
        lang={lang}
        t={t}
        onRefreshData={onRefreshData}
      />
    </div>
  );
}
