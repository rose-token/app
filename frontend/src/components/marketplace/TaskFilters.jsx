import React from 'react';

const TaskFilters = ({ filters, setFilters }) => {
  const handleFilterChange = (filterName) => {
    setFilters(prev => ({
      ...prev,
      [filterName]: !prev[filterName]
    }));
  };

  const resetFilters = () => {
    setFilters({
      needStakeholder: false,
      needWorker: false,
      myTasks: false,
      showClosed: false
    });
  };

  const usingCustomFilters =
    filters.needStakeholder ||
    filters.needWorker ||
    filters.myTasks ||
    filters.showClosed;

  const checkboxStyle = {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-secondary)',
    cursor: 'pointer',
    accentColor: 'var(--rose-gold)'
  };

  return (
    <div
      className="mb-6 p-5 rounded-xl"
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
          Filter Tasks
        </h3>
        {usingCustomFilters && (
          <button
            onClick={resetFilters}
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--rose-pink)' }}
          >
            Reset filters
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { key: 'needStakeholder', label: 'Need Stakeholder', color: 'var(--warning)' },
          { key: 'needWorker', label: 'Need Worker', color: 'var(--info)' },
          { key: 'myTasks', label: 'My Tasks', color: 'var(--rose-pink)' },
          { key: 'showClosed', label: 'Show Closed', color: 'var(--text-muted)' }
        ].map((filter) => (
          <label
            key={filter.key}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={filters[filter.key]}
              onChange={() => handleFilterChange(filter.key)}
              style={checkboxStyle}
            />
            <span
              className="text-sm transition-colors"
              style={{ color: filters[filter.key] ? filter.color : 'var(--text-secondary)' }}
            >
              {filter.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default TaskFilters;
