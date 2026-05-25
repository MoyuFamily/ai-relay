'use client';

import React from 'react';

interface StepperIndicatorProps {
  steps: string[];
  currentStep: number;
}

export default function StepperIndicator({ steps, currentStep }: StepperIndicatorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
      {steps.map((step, index) => {
        const completed = index < currentStep;
        const active = index === currentStep;
        return (
          <React.Fragment key={step}>
            <div
              aria-current={active ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}
            >
              <div style={{
                width: '30px',
                height: '30px',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                fontWeight: 800,
                color: completed || active ? '#fff' : '#94a3b8',
                background: completed
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : active
                    ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
                    : 'rgba(15, 23, 42, 0.8)',
                border: active ? '1px solid rgba(147, 197, 253, 0.7)' : '1px solid rgba(255,255,255,0.08)',
                boxShadow: active ? '0 0 22px rgba(99, 102, 241, 0.35)' : 'none',
                flexShrink: 0,
              }}>
                {completed ? '✓' : index + 1}
              </div>
              <span style={{
                color: active ? '#e0e7ff' : completed ? '#86efac' : '#94a3b8',
                fontSize: '0.82rem',
                fontWeight: active ? 700 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div style={{
                height: '1px',
                flex: 1,
                minWidth: '24px',
                background: completed
                  ? 'linear-gradient(90deg, rgba(16,185,129,0.8), rgba(59,130,246,0.45))'
                  : 'rgba(255,255,255,0.08)',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
