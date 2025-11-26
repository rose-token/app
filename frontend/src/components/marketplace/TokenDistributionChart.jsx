import React from 'react';

const TokenDistributionChart = () => {
  const distributions = [
    { label: 'Worker', percentage: '95%', color: 'var(--info)', bgColor: 'var(--info-bg)' },
    { label: 'Stakeholder', percentage: '5%', color: 'var(--warning)', bgColor: 'var(--warning-bg)' },
    { label: 'DAO Treasury', percentage: '2%', color: 'var(--rose-pink)', bgColor: 'var(--rose-pink-muted)' }
  ];

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-all duration-300 hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <h2 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
        Token Distribution
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {distributions.map((item) => (
          <div
            key={item.label}
            className="rounded-xl p-5 flex items-center justify-between"
            style={{ background: item.bgColor, border: `1px solid ${item.color}30` }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: item.color }}
              />
              <span className="font-medium text-[0.9375rem]" style={{ color: item.color }}>
                {item.label}
              </span>
            </div>
            <span
              className="font-display text-2xl font-semibold"
              style={{ color: item.color }}
            >
              {item.percentage}
            </span>
          </div>
        ))}
      </div>

      <div
        className="p-5 rounded-xl"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <p className="font-medium mb-3 text-sm" style={{ color: 'var(--text-primary)' }}>
          100 ROSE task example:
        </p>
        <div className="space-y-2">
          {[
            { label: 'Customer deposits', value: '100 ROSE', note: '(escrowed in contract)' },
            { label: 'Stakeholder stakes', value: '10 ROSE', note: '(10% of deposit, returned on completion)' },
            { label: 'Worker completes', value: '95 ROSE', note: '' },
            { label: 'Stakeholder verifies', value: '15 ROSE', note: '(stake + 5% fee)' },
            { label: 'Platform mints', value: '2 ROSE', note: '(2% to DAO treasury)' }
          ].map((item, i) => (
            <p key={i} className="text-[0.8125rem]" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-muted)' }}>•</span>{' '}
              {item.label}:{' '}
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
              {item.note && <span style={{ color: 'var(--text-muted)' }}> {item.note}</span>}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TokenDistributionChart;
