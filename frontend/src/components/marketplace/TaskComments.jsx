import React, { useState, useEffect, useRef } from 'react';
import { useComments } from '../../hooks/useComments';
import ProfileBadge from '../profile/ProfileBadge';
import Spinner from '../ui/Spinner';

/**
 * TaskComments - Comment section for a task card.
 * Shows comment count badge, expandable comment list, and input form.
 */
const TaskComments = ({ taskId }) => {
  const {
    comments,
    commentCount,
    pagination,
    isLoading,
    isPosting,
    error,
    fetchComments,
    postComment,
    canComment,
  } = useComments(taskId);

  const [isExpanded, setIsExpanded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const textareaRef = useRef(null);
  const commentsEndRef = useRef(null);

  // Load comments when expanded
  useEffect(() => {
    if (isExpanded && comments.length === 0 && commentCount > 0) {
      fetchComments();
    }
  }, [isExpanded, comments.length, commentCount, fetchComments]);

  // Scroll to bottom when new comment is added
  useEffect(() => {
    if (commentsEndRef.current && isExpanded) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments.length, isExpanded]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || isPosting) return;

    const result = await postComment(newComment);
    if (result) {
      setNewComment('');
      // Focus back on textarea for quick follow-up
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Ctrl+Enter or Cmd+Enter
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit(e);
    }
  };

  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="mt-5">
      {/* Toggle button with comment count */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium transition-all duration-200 hover:bg-[rgba(212,165,165,0.2)] hover:border-[var(--rose-pink)]"
        style={{
          padding: '0.75rem 1rem',
          background: 'var(--rose-pink-muted)',
          border: '1px solid rgba(212, 165, 165, 0.2)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--rose-pink-light)',
          cursor: 'pointer',
          width: '100%',
          justifyContent: 'space-between',
        }}
      >
        <span className="flex items-center gap-2">
          <span>💬</span>
          Comments
          {commentCount > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: 'rgba(212, 165, 165, 0.3)',
                color: 'var(--rose-pink-light)',
              }}
            >
              {commentCount}
            </span>
          )}
        </span>
        <span
          className="transition-transform duration-200"
          style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      {/* Expanded comment section */}
      {isExpanded && (
        <div
          className="mt-3 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {/* Comment list */}
          <div
            className="p-4 space-y-4 overflow-y-auto"
            style={{ maxHeight: '400px' }}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner className="h-5 w-5" />
                <span className="ml-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Loading comments...
                </span>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No comments yet. Be the first to comment!
                </p>
              </div>
            ) : (
              <>
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="rounded-lg p-3"
                    style={{
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ProfileBadge address={comment.authorAddress} size="xs" />
                        {comment.isAgent && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase"
                            style={{
                              background: 'var(--info-bg)',
                              border: '1px solid rgba(96, 165, 250, 0.3)',
                              color: 'var(--info)',
                            }}
                          >
                            Agent
                          </span>
                        )}
                      </div>
                      <span
                        className="text-xs"
                        style={{ color: 'var(--text-muted)' }}
                        title={new Date(comment.createdAt).toLocaleString()}
                      >
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <p
                      className="text-sm whitespace-pre-wrap break-words"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {comment.content}
                    </p>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center gap-2 pt-2">
                {pagination.hasPrev && (
                  <button
                    onClick={() => fetchComments(pagination.page - 1)}
                    className="px-3 py-1 text-xs rounded-lg"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    ← Prev
                  </button>
                )}
                <span className="text-xs py-1" style={{ color: 'var(--text-muted)' }}>
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                {pagination.hasNext && (
                  <button
                    onClick={() => fetchComments(pagination.page + 1)}
                    className="px-3 py-1 text-xs rounded-lg"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Next →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Comment input */}
          <div
            className="p-4"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            {error && (
              <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>
                {error}
              </p>
            )}

            {canComment ? (
              <form onSubmit={handleSubmit} className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Write a comment..."
                  disabled={isPosting}
                  rows={2}
                  maxLength={2000}
                  className="flex-1 px-3 py-2 rounded-lg text-sm resize-none"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    opacity: isPosting ? 0.6 : 1,
                  }}
                />
                <button
                  type="submit"
                  disabled={isPosting || !newComment.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold self-end transition-all duration-200"
                  style={{
                    background:
                      isPosting || !newComment.trim()
                        ? 'var(--bg-secondary)'
                        : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                    color:
                      isPosting || !newComment.trim()
                        ? 'var(--text-muted)'
                        : 'var(--bg-primary)',
                    boxShadow:
                      isPosting || !newComment.trim()
                        ? 'none'
                        : '0 4px 16px rgba(212, 165, 165, 0.3)',
                    opacity: isPosting || !newComment.trim() ? 0.6 : 1,
                    cursor: isPosting || !newComment.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isPosting ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    'Send'
                  )}
                </button>
              </form>
            ) : (
              <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                Connect your wallet to comment
              </p>
            )}

            {canComment && newComment.length > 0 && (
              <p className="text-xs mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
                {newComment.length}/2000 · Ctrl+Enter to send
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskComments;
