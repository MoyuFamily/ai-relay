'use client';

import React from 'react';
import type { AdminData } from '../types';

interface ProviderTableProps {
  data: AdminData;
  selectedProvider: string | null;
  setSelectedProvider: (providerId: string | null) => void;
  setEditingCustomProvider: (val: any) => void;
  setCustomProviderModalOpen: (val: boolean) => void;
  t: any;
}

export default function ProviderTable({
  data,
  selectedProvider,
  setSelectedProvider,
  setEditingCustomProvider,
  setCustomProviderModalOpen,
  t,
}: ProviderTableProps) {
  return (
    <section className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fff', fontWeight: 600 }}>
          {t.providerKeyPools}
        </h2>
        <button
          onClick={() => {
            setEditingCustomProvider(null);
            setCustomProviderModalOpen(true);
          }}
          style={{
            padding: '0.4rem 0.8rem',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#2563eb',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 'bold',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2563eb'; }}
        >
          {t.addCustomProvider}
        </button>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: 0, marginBottom: '1.25rem' }}>
        {t.providerKeyPoolsDesc}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="styled-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>{t.tblProvider}</th>
              <th style={{ textAlign: 'center', padding: '0.75rem 0.5rem', minWidth: '112px', whiteSpace: 'nowrap' }}>{t.tblStatus}</th>
              <th style={{ textAlign: 'center', padding: '0.75rem 0.5rem' }}>{t.tblKeys}</th>
              <th style={{ textAlign: 'center', padding: '0.75rem 0.5rem' }}>{t.tblAvailable}</th>
              <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>{t.tblModelPrefixes}</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => {
              const isSelected = selectedProvider === p.id;
              return (
                <tr
                  key={p.id}
                  className={`provider-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedProvider(isSelected ? null : p.id)}
                  style={{
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '0.75rem 0.5rem', fontWeight: '600', color: isSelected ? '#60a5fa' : '#f3f4f6' }}>
                    {isSelected ? '👉 ' : ''}{p.name}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{
                      padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500,
                      backgroundColor: p.configured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: p.configured ? '#34d399' : '#fca5a5',
                      border: p.configured ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.configured ? t.statusOk : t.statusNoKeys}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center', color: '#d1d5db' }}>{p.keyCount}</td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                    <span style={{
                      color: p.availableKeys > 0 ? '#34d399' : '#ef4444',
                      fontWeight: 'bold',
                    }}>
                      {p.availableKeys}
                    </span>
                  </td>
                  <td style={{
                    padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontSize: '0.85rem',
                    color: '#9ca3af',
                  }}>
                    {p.modelPrefixes.join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
