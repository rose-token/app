/**
 * GitHubIntegration Component
 *
 * Allows users to link their GitHub account and authorize repositories
 * for automatic PR merging when tasks are completed.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Github, Link2, Unlink, Plus, Trash2, ExternalLink } from 'lucide-react';
import Spinner from '../ui/Spinner';
import { useUserAuth } from '../../hooks/useUserAuth';

const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3000';

export default function GitHubIntegration() {
  const { address, isConnected } = useAccount();
  const { userPost, userDelete } = useUserAuth();
  const [linked, setLinked] = useState(false);
  const [username, setUsername] = useState('');
  const [repos, setRepos] = useState([]);
  const [newRepo, setNewRepo] = useState('');
  const [loading, setLoading] = useState(true);
  const [repoLoading, setRepoLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStatus = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${SIGNER_URL}/api/github/auth/status?wallet=${address}`);
      const data = await res.json();
      setLinked(data.linked);
      setUsername(data.username || '');
    } catch (err) {
      console.error('Failed to fetch GitHub status:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  const fetchRepos = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${SIGNER_URL}/api/github/repos?wallet=${address}`);
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      fetchStatus();
      fetchRepos();
    }
  }, [address, fetchStatus, fetchRepos]);

  const startLinking = async () => {
    try {
      const res = await fetch(`${SIGNER_URL}/api/github/auth/start?wallet=${address}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      window.location.href = data.authUrl;
    } catch (err) {
      setError('Failed to start GitHub linking');
    }
  };

  const unlinkAccount = async () => {
    if (!confirm('This will remove all authorized repos. Continue?')) return;
    try {
      const res = await userDelete('/api/github/auth/unlink', 'github-unlink');
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to unlink account');
        return;
      }
      setLinked(false);
      setUsername('');
      setRepos([]);
    } catch (err) {
      setError('Failed to unlink account');
    }
  };

  const authorizeRepo = async () => {
    setError('');
    const parts = newRepo.trim().split('/');
    if (parts.length !== 2) {
      setError('Format: owner/repo');
      return;
    }

    setRepoLoading(true);
    try {
      const res = await userPost('/api/github/repos/authorize', 'github-repo-authorize', {
        repoOwner: parts[0],
        repoName: parts[1],
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }

      setNewRepo('');
      fetchRepos();
    } catch (err) {
      setError('Failed to authorize repo');
    } finally {
      setRepoLoading(false);
    }
  };

  const revokeRepo = async (repoOwner, repoName) => {
    try {
      const res = await userDelete('/api/github/repos/revoke', 'github-repo-revoke', {
        repoOwner,
        repoName,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to revoke repo');
        return;
      }
      fetchRepos();
    } catch (err) {
      setError('Failed to revoke repo');
    }
  };

  if (!isConnected) return null;

  if (loading) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-6 flex items-center justify-center"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-6"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* GitHub Account Link Status */}
      <div
        className="flex items-center justify-between mb-4 pb-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--bg-secondary)' }}
          >
            <Github className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {linked ? `@${username}` : 'GitHub Account'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {linked ? 'Linked' : 'Not linked'}
            </p>
          </div>
        </div>
        {linked ? (
          <button
            onClick={unlinkAccount}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--error)',
            }}
          >
            <Unlink className="w-3.5 h-3.5" />
            Unlink
          </button>
        ) : (
          <button
            onClick={startLinking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: 'var(--rose-gold)',
              color: 'var(--bg-primary)',
            }}
          >
            <Link2 className="w-3.5 h-3.5" />
            Link Account
          </button>
        )}
      </div>

      {/* Authorized Repos Section */}
      {linked && (
        <>
          <div className="mb-3">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Authorized Repositories
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              The Rose Protocol bot can auto-merge PRs to these repos when you create tasks with
              GitHub integration enabled.
            </p>
          </div>

          {/* Add Repo Input */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              placeholder="owner/repo"
              className="flex-1 px-3 py-2 rounded-lg text-sm"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
              onKeyDown={(e) => e.key === 'Enter' && authorizeRepo()}
            />
            <button
              onClick={authorizeRepo}
              disabled={repoLoading || !newRepo.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'var(--rose-gold)',
                color: 'var(--bg-primary)',
              }}
            >
              {repoLoading ? <Spinner className="h-4 w-4" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
          </div>

          {error && (
            <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
              {error}
            </p>
          )}

          {/* Repo List */}
          {repos.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No repositories authorized yet
            </p>
          ) : (
            <div className="space-y-2">
              {repos.map((repo) => (
                <div
                  key={`${repo.repo_owner}/${repo.repo_name}`}
                  className="flex items-center justify-between p-3 rounded-lg"
                  style={{ background: 'var(--bg-secondary)' }}
                >
                  <div className="flex items-center gap-2">
                    <Github className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <a
                      href={`https://github.com/${repo.repo_owner}/${repo.repo_name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium flex items-center gap-1 hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {repo.repo_owner}/{repo.repo_name}
                      <ExternalLink className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                    </a>
                  </div>
                  <button
                    onClick={() => revokeRepo(repo.repo_owner, repo.repo_name)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                    style={{ color: 'var(--error)' }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Info for non-linked state */}
      {!linked && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Link your GitHub account to enable automatic PR merging when tasks are approved. You'll
          need to authorize specific repositories where the bot can merge.
        </p>
      )}
    </div>
  );
}
