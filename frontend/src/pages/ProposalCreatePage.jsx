/**
 * ProposalCreatePage - Create a new governance proposal
 * Form to submit proposals for DAO funding
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import { CONTRACTS, GOVERNANCE_CONSTANTS, Track, TrackLabels, TrackColors, TRACK_CONSTANTS } from '../constants/contracts';
import { SKILLS } from '../constants/skills';
import useProposals from '../hooks/useProposals';
import useGovernance from '../hooks/useGovernance';
import ReputationBadge from '../components/governance/ReputationBadge';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import Spinner from '../components/ui/Spinner';

const ProposalCreatePage = () => {
  const navigate = useNavigate();
  const { address: account, isConnected } = useAccount();
  const { createProposal, actionLoading, error: proposalError, setError } = useProposals();
  const { reputation, canPropose, userStats } = useGovernance();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    value: '',
    deadline: '',
    deliverables: '',
    skills: [],
    track: Track.Slow, // Default to Slow Track
  });
  const [formErrors, setFormErrors] = useState({});

  // Get treasury ROSE balance for proposal limits
  const { data: treasuryRoseBalance } = useReadContract({
    address: CONTRACTS.TOKEN,
    abi: RoseTokenABI,
    functionName: 'balanceOf',
    args: [CONTRACTS.TREASURY],
    query: {
      enabled: !!CONTRACTS.TOKEN && !!CONTRACTS.TREASURY,
    },
  });

  // Parse treasury ROSE balance
  const treasuryValue = treasuryRoseBalance
    ? parseFloat(formatUnits(treasuryRoseBalance, 18))
    : 0;

  // Handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setFormErrors(prev => ({ ...prev, [name]: '' }));
  };

  // Handle skill toggle
  const toggleSkill = (skill) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill],
    }));
  };

  // Calculate track-specific limits
  const fastTrackLimit = treasuryValue * (TRACK_CONSTANTS[Track.Fast].TREASURY_LIMIT_BPS / 10000); // 1% of treasury

  // Handle track change
  const handleTrackChange = (newTrack) => {
    setFormData(prev => ({ ...prev, track: newTrack }));
    setFormErrors(prev => ({ ...prev, track: '', value: '' }));
  };

  // Validate form
  const validateForm = () => {
    const errors = {};

    if (!formData.title.trim()) {
      errors.title = 'Title is required';
    } else if (formData.title.length > 100) {
      errors.title = 'Title must be 100 characters or less';
    }

    if (!formData.description.trim()) {
      errors.description = 'Description is required';
    }

    const proposalValue = parseFloat(formData.value);
    if (!formData.value || proposalValue <= 0) {
      errors.value = 'Value must be greater than 0';
    } else if (proposalValue > treasuryValue) {
      errors.value = `Value exceeds treasury balance (${treasuryValue.toLocaleString()} ROSE)`;
    } else if (formData.track === Track.Fast && proposalValue > fastTrackLimit) {
      errors.value = `Fast Track limit: ${fastTrackLimit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ROSE (1% of treasury)`;
    }

    if (!formData.deadline) {
      errors.deadline = 'Deadline is required';
    } else {
      const deadlineDate = new Date(formData.deadline);
      const minDeadline = new Date();
      minDeadline.setDate(minDeadline.getDate() + 7); // Minimum 1 week
      if (deadlineDate < minDeadline) {
        errors.deadline = 'Deadline must be at least 1 week from now';
      }
    }

    if (!formData.deliverables.trim()) {
      errors.deliverables = 'Deliverables are required';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) return;

    try {
      await createProposal(formData);
      navigate('/governance');
    } catch (err) {
      console.error('Failed to create proposal:', err);
    }
  };

  // Calculate minimum deadline (1 week from now)
  const minDeadline = new Date();
  minDeadline.setDate(minDeadline.getDate() + 7);
  const minDeadlineStr = minDeadline.toISOString().split('T')[0];

  if (!isConnected) {
    return (
      <div className="animate-fade-in">
        <WalletNotConnected />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      {/* Back Link */}
      <Link
        to="/governance"
        className="inline-flex items-center gap-1 text-sm mb-6 hover:text-accent transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        &larr; Back to Governance
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Create Proposal</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Submit a proposal to fund work from the DAO treasury
        </p>
      </div>

      {/* Eligibility Check */}
      {!canPropose && (
        <div
          className="card mb-6"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'var(--error)' }}
        >
          <h3 className="font-semibold mb-2" style={{ color: 'var(--error)' }}>
            Not Eligible to Propose
          </h3>
          <p className="text-sm mb-3">
            You need 90%+ reputation to create proposals.
          </p>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--text-muted)' }}>Your reputation:</span>
            <ReputationBadge
              score={reputation || 60}
              tasksCompleted={userStats?.tasksCompleted}
              disputes={userStats?.disputes}
              failedProposals={userStats?.failedProposals}
            />
          </div>
        </div>
      )}

      {/* Treasury Info */}
      <div className="card mb-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Available Treasury</p>
            <p className="text-xl font-bold gradient-text">
              {treasuryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} ROSE
            </p>
          </div>
          <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
            Proposal value cannot exceed treasury balance
          </p>
        </div>
      </div>

      {/* Track Selection */}
      <div className="card mb-6">
        <label className="block font-medium mb-3">
          Proposal Track <span style={{ color: 'var(--error)' }}>*</span>
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Fast Track */}
          <button
            type="button"
            onClick={() => handleTrackChange(Track.Fast)}
            className="p-4 rounded-lg text-left transition-all"
            style={{
              backgroundColor: formData.track === Track.Fast ? 'rgba(14, 165, 233, 0.15)' : 'var(--bg-tertiary)',
              border: `2px solid ${formData.track === Track.Fast ? 'var(--accent)' : 'var(--border-color)'}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="font-semibold"
                style={{ color: formData.track === Track.Fast ? 'var(--accent)' : 'var(--text-primary)' }}
              >
                Fast Track
              </span>
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: 'rgba(14, 165, 233, 0.2)',
                  color: 'var(--accent)',
                }}
              >
                3 days
              </span>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Quick decisions for smaller requests
            </p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>Max: {fastTrackLimit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ROSE (1% treasury)</li>
              <li>10% quorum required</li>
              <li>Vote with full VP on multiple proposals</li>
            </ul>
          </button>

          {/* Slow Track */}
          <button
            type="button"
            onClick={() => handleTrackChange(Track.Slow)}
            className="p-4 rounded-lg text-left transition-all"
            style={{
              backgroundColor: formData.track === Track.Slow ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-tertiary)',
              border: `2px solid ${formData.track === Track.Slow ? 'var(--warning)' : 'var(--border-color)'}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="font-semibold"
                style={{ color: formData.track === Track.Slow ? 'var(--warning)' : 'var(--text-primary)' }}
              >
                Slow Track
              </span>
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.2)',
                  color: 'var(--warning)',
                }}
              >
                14 days
              </span>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              Thorough review for larger requests
            </p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>No treasury limit</li>
              <li>25% quorum required</li>
              <li>VP is a budget across proposals</li>
            </ul>
          </button>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error Display */}
        {proposalError && (
          <div
            className="p-4 rounded-lg flex justify-between items-center"
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
          >
            <span>{proposalError}</span>
            <button type="button" onClick={() => setError(null)} className="font-bold">&times;</button>
          </div>
        )}

        {/* Title */}
        <div className="card">
          <label className="block font-medium mb-2">
            Title <span style={{ color: 'var(--error)' }}>*</span>
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="Brief, descriptive title for your proposal"
            maxLength={100}
            className="w-full px-4 py-3 rounded-lg"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: formErrors.title ? '1px solid var(--error)' : '1px solid var(--border-color)',
            }}
          />
          <div className="flex justify-between mt-1">
            {formErrors.title && (
              <span className="text-xs" style={{ color: 'var(--error)' }}>{formErrors.title}</span>
            )}
            <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
              {formData.title.length}/100
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="card">
          <label className="block font-medium mb-2">
            Description <span style={{ color: 'var(--error)' }}>*</span>
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Detailed description of the work to be done, why it's important, and how it benefits the ecosystem"
            rows={6}
            className="w-full px-4 py-3 rounded-lg resize-none"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: formErrors.description ? '1px solid var(--error)' : '1px solid var(--border-color)',
            }}
          />
          {formErrors.description && (
            <span className="text-xs" style={{ color: 'var(--error)' }}>{formErrors.description}</span>
          )}
        </div>

        {/* Value and Deadline */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card">
            <label className="block font-medium mb-2">
              Value (ROSE) <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              type="number"
              name="value"
              value={formData.value}
              onChange={handleChange}
              placeholder="0"
              min="0"
              step="1"
              className="w-full px-4 py-3 rounded-lg"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: formErrors.value ? '1px solid var(--error)' : '1px solid var(--border-color)',
              }}
            />
            {formErrors.value && (
              <span className="text-xs" style={{ color: 'var(--error)' }}>{formErrors.value}</span>
            )}
          </div>

          <div className="card">
            <label className="block font-medium mb-2">
              Deadline <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              type="date"
              name="deadline"
              value={formData.deadline}
              onChange={handleChange}
              min={minDeadlineStr}
              className="w-full px-4 py-3 rounded-lg"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: formErrors.deadline ? '1px solid var(--error)' : '1px solid var(--border-color)',
              }}
            />
            {formErrors.deadline && (
              <span className="text-xs" style={{ color: 'var(--error)' }}>{formErrors.deadline}</span>
            )}
          </div>
        </div>

        {/* Deliverables */}
        <div className="card">
          <label className="block font-medium mb-2">
            Deliverables <span style={{ color: 'var(--error)' }}>*</span>
          </label>
          <textarea
            name="deliverables"
            value={formData.deliverables}
            onChange={handleChange}
            placeholder="What specific outcomes will be delivered? How will completion be verified?"
            rows={3}
            className="w-full px-4 py-3 rounded-lg resize-none"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: formErrors.deliverables ? '1px solid var(--error)' : '1px solid var(--border-color)',
            }}
          />
          {formErrors.deliverables && (
            <span className="text-xs" style={{ color: 'var(--error)' }}>{formErrors.deliverables}</span>
          )}
        </div>

        {/* Skills */}
        <div className="card">
          <label className="block font-medium mb-2">
            Skills Needed
          </label>
          <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
            Select the skills required for this work (optional)
          </p>
          <div className="flex flex-wrap gap-2">
            {SKILLS.map(skill => (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggleSkill(skill.id)}
                className="px-3 py-1.5 rounded-full text-sm transition-all"
                style={{
                  backgroundColor: formData.skills.includes(skill.id)
                    ? `${skill.color}30`
                    : 'var(--bg-tertiary)',
                  border: `1px solid ${formData.skills.includes(skill.id) ? skill.color : 'var(--border-color)'}`,
                  color: formData.skills.includes(skill.id) ? skill.color : 'var(--text-secondary)',
                }}
              >
                {skill.name}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <Link to="/governance" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!canPropose || actionLoading.create}
            className="btn-primary flex items-center justify-center gap-2"
            style={{ opacity: !canPropose || actionLoading.create ? 0.5 : 1 }}
          >
            {actionLoading.create && <Spinner />}
            {actionLoading.create ? 'Creating...' : 'Create Proposal'}
          </button>
        </div>

        {/* Info - Track-specific */}
        <div className="card text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          <strong>How {formData.track === Track.Fast ? 'Fast Track' : 'Slow Track'} works:</strong>
          <ul className="mt-2 list-disc list-inside space-y-1">
            {formData.track === Track.Fast ? (
              <>
                <li>3-day voting period with 1-day snapshot delay</li>
                <li>Requires 10% quorum and 58.33% approval to pass</li>
                <li>Limited to 1% of treasury ({fastTrackLimit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ROSE)</li>
                <li>Voters can use full VP on multiple Fast Track proposals</li>
              </>
            ) : (
              <>
                <li>14-day voting period with immediate voting</li>
                <li>Requires 25% quorum and 58.33% approval to pass</li>
                <li>No treasury limit - suitable for larger requests</li>
                <li>Voters' VP is a budget across all active Slow Track proposals</li>
              </>
            )}
            <li>Passed proposals create marketplace tasks funded by the treasury</li>
            <li>You will act as the "customer" for the resulting task</li>
            <li>Failed proposals result in a small reputation penalty</li>
          </ul>
        </div>
      </form>
    </div>
  );
};

export default ProposalCreatePage;
