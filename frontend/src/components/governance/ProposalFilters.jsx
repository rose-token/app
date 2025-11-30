/**
 * ProposalFilters - Filter controls for proposal list
 * Allows filtering by status and sorting
 */

import React from 'react';
import { ProposalStatus, ProposalStatusLabels } from '../../constants/contracts';

const ProposalFilters = ({ filters, setFilters }) => {
  const statusOptions = [
    { value: 'all', label: 'All Proposals' },
    { value: ProposalStatus.Active, label: 'Active' },
    { value: ProposalStatus.Passed, label: 'Passed' },
    { value: ProposalStatus.Executed, label: 'Executed' },
    { value: ProposalStatus.Failed, label: 'Failed' },
    { value: ProposalStatus.Cancelled, label: 'Cancelled' },
  ];

  const sortOptions = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'valueHigh', label: 'Highest Value' },
    { value: 'valueLow', label: 'Lowest Value' },
    { value: 'endingSoon', label: 'Ending Soon' },
  ];

  return (
    <div className="flex flex-wrap gap-4 mb-6">
      {/* Status Filter */}
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          Status
        </label>
        <select
          value={filters.status}
          onChange={(e) => setFilters(prev => ({
            ...prev,
            status: e.target.value === 'all' ? 'all' : parseInt(e.target.value),
          }))}
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {statusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sort */}
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          Sort By
        </label>
        <select
          value={filters.sort}
          onChange={(e) => setFilters(prev => ({ ...prev, sort: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
          }}
        >
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* My Proposals Toggle */}
      <div className="flex items-end">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.myProposals}
            onChange={(e) => setFilters(prev => ({ ...prev, myProposals: e.target.checked }))}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="text-sm">My Proposals</span>
        </label>
      </div>

      {/* My Votes Toggle */}
      <div className="flex items-end">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.myVotes}
            onChange={(e) => setFilters(prev => ({ ...prev, myVotes: e.target.checked }))}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="text-sm">My Votes</span>
        </label>
      </div>
    </div>
  );
};

export default ProposalFilters;
