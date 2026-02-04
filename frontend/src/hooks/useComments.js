/**
 * useComments Hook
 *
 * Manages task comments: fetching, posting, and signing.
 * Uses personal_sign for wallet authentication.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL;

/**
 * Build the comment message string for signing.
 * Must match backend buildCommentMessage() exactly.
 */
function buildCommentMessage(taskId, content, timestamp) {
  return `Rose Token Comment\n\nTask: #${taskId}\nComment: ${content}\nTimestamp: ${timestamp}`;
}

/**
 * Hook for task comments.
 * @param {number} taskId - The task ID
 * @returns {Object} comments state and actions
 */
export function useComments(taskId) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [comments, setComments] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState(null);
  const [commentCount, setCommentCount] = useState(0);

  /**
   * Fetch comments for the task.
   */
  const fetchComments = useCallback(async (page = 1) => {
    if (!taskId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${SIGNER_URL}/api/tasks/${taskId}/comments?page=${page}&limit=50`
      );
      if (!res.ok) {
        throw new Error('Failed to fetch comments');
      }

      const data = await res.json();
      setComments(data.comments || []);
      setPagination(data.pagination || null);
      setCommentCount(data.pagination?.total || 0);
    } catch (err) {
      console.error('[useComments] Fetch error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  /**
   * Fetch just the comment count (lightweight).
   */
  const fetchCommentCount = useCallback(async () => {
    if (!taskId) return;

    try {
      const res = await fetch(`${SIGNER_URL}/api/tasks/${taskId}/comments/count`);
      if (res.ok) {
        const data = await res.json();
        setCommentCount(data.count || 0);
      }
    } catch (err) {
      // Silently fail for count — not critical
      console.error('[useComments] Count fetch error:', err);
    }
  }, [taskId]);

  /**
   * Post a new comment. Signs with wallet.
   */
  const postComment = useCallback(async (content) => {
    if (!isConnected || !address) {
      setError('Wallet not connected');
      return null;
    }

    if (!content || content.trim().length === 0) {
      setError('Comment cannot be empty');
      return null;
    }

    setIsPosting(true);
    setError(null);

    try {
      const timestamp = Date.now();
      const message = buildCommentMessage(taskId, content.trim(), timestamp);

      // Sign the message
      const signature = await signMessageAsync({ message });

      // Post to backend
      const res = await fetch(`${SIGNER_URL}/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          content: content.trim(),
          timestamp,
          signature,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to post comment');
      }

      const data = await res.json();

      // Add new comment to the list
      if (data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setCommentCount((prev) => prev + 1);
      }

      return data.comment;
    } catch (err) {
      console.error('[useComments] Post error:', err);
      // Don't show "user rejected" as an error
      if (err.message?.includes('User rejected') || err.message?.includes('user rejected')) {
        setError(null);
        return null;
      }
      setError(err.message);
      return null;
    } finally {
      setIsPosting(false);
    }
  }, [taskId, address, isConnected, signMessageAsync]);

  // Fetch comment count on mount
  useEffect(() => {
    fetchCommentCount();
  }, [fetchCommentCount]);

  return {
    comments,
    commentCount,
    pagination,
    isLoading,
    isPosting: isPosting || isSigning,
    error,
    fetchComments,
    fetchCommentCount,
    postComment,
    canComment: isConnected && !!address,
  };
}

export default useComments;
