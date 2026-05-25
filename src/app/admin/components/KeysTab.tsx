'use client';

import React from 'react';
import type { AdminData } from '../types';
import ProviderTable from './ProviderTable';
import ProviderConfigEditor from './ProviderConfigEditor';
import CustomProviderModal from './CustomProviderModal';

interface KeysTabProps {
  data: AdminData;
  lang: 'zh' | 'en';
  t: any;
  selectedProvider: string | null;
  setSelectedProvider: (provider: string | null) => void;
  providerKeys: Array<{ hash: string; masked: string; source: string }> | null;
  providerFallbacks: {
    current: string[];
    staticDefault: string | null;
    staticDefaults: string[];
    isOverride: boolean;
    availableModels: Record<string, { id: string; displayName: string }[]>;
  } | null;
  newKeyInput: string;
  setNewKeyInput: (val: string) => void;
  operationLoading: boolean;
  configMessage: { text: string; type: 'success' | 'error' } | null;
  setConfigMessage: (msg: { text: string; type: 'success' | 'error' } | null) => void;
  testingHash: string | null;
  testingInput: boolean;
  activeFallbacks: string[];
  setActiveFallbacks: (fallbacks: string[]) => void;
  selectedFallbackToAdd: string;
  setSelectedFallbackToAdd: (val: string) => void;
  onAddKey: () => Promise<void>;
  onDeleteKey: (providerId: string, hash: string) => Promise<void>;
  onTestKey: (providerId: string, hash: string, modelId?: string) => Promise<void>;
  onTestInputKey: (modelId?: string) => Promise<void>;
  onSaveFallbacks: (newChain: string[]) => Promise<void>;
  onResetFallbacks: () => Promise<void>;
  customProviderModalOpen: boolean;
  setCustomProviderModalOpen: (val: boolean) => void;
  editingCustomProvider: any;
  setEditingCustomProvider: (val: any) => void;
  onSaveCustomProvider: (provider: any) => Promise<void>;
  onTestCustomProvider: (provider: any, apiKeyValue: string, modelId?: string) => Promise<any>;
  onDeleteCustomProvider: (name: string) => Promise<void>;
}

export default function KeysTab(props: KeysTabProps) {
  const {
    data,
    lang,
    t,
    selectedProvider,
    setSelectedProvider,
    providerKeys,
    providerFallbacks,
    newKeyInput,
    setNewKeyInput,
    operationLoading,
    configMessage,
    setConfigMessage,
    testingHash,
    testingInput,
    activeFallbacks,
    setActiveFallbacks,
    selectedFallbackToAdd,
    setSelectedFallbackToAdd,
    onAddKey,
    onDeleteKey,
    onTestKey,
    onTestInputKey,
    onSaveFallbacks,
    onResetFallbacks,
    customProviderModalOpen,
    setCustomProviderModalOpen,
    editingCustomProvider,
    setEditingCustomProvider,
    onSaveCustomProvider,
    onTestCustomProvider,
    onDeleteCustomProvider,
  } = props;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .provider-row {
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .provider-row:hover {
          background-color: rgba(255, 255, 255, 0.03) !important;
        }
        .provider-row.selected {
          background-color: rgba(59, 130, 246, 0.1) !important;
          border-left: 3px solid #3b82f6 !important;
        }
        .config-card {
          animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .fallback-item {
          transition: all 0.2s ease;
        }
        .fallback-item:hover {
          background-color: rgba(255, 255, 255, 0.02) !important;
        }
        .styled-table th {
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          font-weight: 500;
          color: #9ca3af;
        }
        .styled-table td {
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .custom-select {
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg fill='none' height='24' stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><polyline points='6 9 12 15 18 9'/></svg>");
          background-repeat: no-repeat;
          background-position: right 0.5rem center;
          background-size: 1rem;
          padding-right: 2rem !important;
        }
      `}} />

      <ProviderTable
        data={data}
        selectedProvider={selectedProvider}
        setSelectedProvider={setSelectedProvider}
        setEditingCustomProvider={setEditingCustomProvider}
        setCustomProviderModalOpen={setCustomProviderModalOpen}
        t={t}
      />

      <ProviderConfigEditor
        data={data}
        lang={lang}
        t={t}
        selectedProvider={selectedProvider}
        setSelectedProvider={setSelectedProvider}
        providerKeys={providerKeys}
        providerFallbacks={providerFallbacks}
        newKeyInput={newKeyInput}
        setNewKeyInput={setNewKeyInput}
        operationLoading={operationLoading}
        configMessage={configMessage}
        setConfigMessage={setConfigMessage}
        testingHash={testingHash}
        testingInput={testingInput}
        activeFallbacks={activeFallbacks}
        setActiveFallbacks={setActiveFallbacks}
        selectedFallbackToAdd={selectedFallbackToAdd}
        setSelectedFallbackToAdd={setSelectedFallbackToAdd}
        onAddKey={onAddKey}
        onDeleteKey={onDeleteKey}
        onTestKey={onTestKey}
        onTestInputKey={onTestInputKey}
        onSaveFallbacks={onSaveFallbacks}
        onResetFallbacks={onResetFallbacks}
        setEditingCustomProvider={setEditingCustomProvider}
        setCustomProviderModalOpen={setCustomProviderModalOpen}
        onDeleteCustomProvider={onDeleteCustomProvider}
      />

      <CustomProviderModal
        data={data}
        lang={lang}
        t={t}
        customProviderModalOpen={customProviderModalOpen}
        setCustomProviderModalOpen={setCustomProviderModalOpen}
        editingCustomProvider={editingCustomProvider}
        setEditingCustomProvider={setEditingCustomProvider}
        onSaveCustomProvider={onSaveCustomProvider}
        onTestCustomProvider={onTestCustomProvider}
      />
    </div>
  );
}
