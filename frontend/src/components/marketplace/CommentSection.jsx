import React, { useState, useEffect, useCallback } from 'react';

const CommentSection = ({ taskId, roseMarketplace, task, isAuthorized = false }) => {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };
  
  const fetchComments = useCallback(async () => {
    if (!roseMarketplace || !taskId) return;
    
    try {
      setIsLoading(true);
      const comments = await roseMarketplace.getTaskComments(taskId);
      setComments(comments);
    } catch (err) {
      console.error('Error fetching comments:', err);
      setError('Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  }, [roseMarketplace, taskId, setIsLoading, setComments, setError]);
  
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !roseMarketplace) return;
    
    try {
      setIsLoading(true);
      setError('');
      
      const tx = await roseMarketplace.addComment(taskId, newComment, replyTo);
      await tx.wait();
      
      setNewComment('');
      if (replyTo !== 0) setReplyTo(0);
      
      await fetchComments();
    } catch (err) {
      console.error('Error adding comment:', err);
      setError('Failed to add comment');
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    if (roseMarketplace && taskId) {
      fetchComments();
      
      const commentFilter = roseMarketplace.filters.CommentAdded(taskId);
      const commentListener = (taskId, commentId, author, parentCommentId) => {
        console.log('Comment added:', { taskId, commentId, author, parentCommentId });
        fetchComments();
      };
      
      roseMarketplace.on(commentFilter, commentListener);
      
      return () => {
        roseMarketplace.off(commentFilter, commentListener);
      };
    }
  }, [roseMarketplace, taskId, fetchComments]);
  
  const threadsMap = {};
  const rootComments = [];
  
  comments.forEach((comment, index) => {
    comment.id = index + 1; // 1-based ID
    comment.replies = [];
    
    if (comment.parentCommentId.toNumber() === 0) {
      rootComments.push(comment);
    } else {
      if (!threadsMap[comment.parentCommentId.toNumber()]) {
        threadsMap[comment.parentCommentId.toNumber()] = [];
      }
      threadsMap[comment.parentCommentId.toNumber()].push(comment);
    }
  });
  
  const renderComment = (comment) => {
    const replies = threadsMap[comment.id] || [];
    const role = comment.author.toLowerCase() === task.customer.toLowerCase() 
      ? 'Customer' 
      : comment.author.toLowerCase() === task.worker.toLowerCase() 
        ? 'Worker' 
        : comment.author.toLowerCase() === task.stakeholder.toLowerCase() 
          ? 'Stakeholder' 
          : 'Visitor';
    
    const getRoleBadgeStyle = () => {
      switch (role) {
        case 'Customer':
          return 'bg-blue-100 text-blue-800';
        case 'Worker':
          return 'bg-green-100 text-green-800';
        case 'Stakeholder':
          return 'bg-purple-100 text-purple-800';
        default:
          return 'bg-gray-100 text-gray-800';
      }
    };
    
    return (
      <div key={comment.id} className="mb-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-medium text-gray-500">
                  {comment.author.slice(0, 6)}...{comment.author.slice(-4)}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${getRoleBadgeStyle()}`}>
                  {role}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                {formatTimestamp(comment.timestamp.toNumber())}
              </div>
            </div>
            <button 
              onClick={() => setReplyTo(comment.id)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Reply
            </button>
          </div>
          <div className="text-sm">
            {comment.content}
          </div>
        </div>
        
        {/* Render replies */}
        {replies.length > 0 && (
          <div className="ml-8 mt-2 border-l-2 border-gray-200 pl-4">
            {replies.map(reply => renderComment(reply))}
          </div>
        )}
      </div>
    );
  };
  
  if (!isAuthorized) {
    return (
      <div className="mt-6 p-4 bg-gray-100 rounded-md text-center">
        <p className="text-gray-600">Comments are only visible to stakeholders, customers, and workers assigned to this task.</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-4">Comments</h3>
      
      {/* Comment form */}
      <form onSubmit={handleAddComment} className="mb-6">
        <div className="mb-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows="3"
            placeholder={replyTo === 0 ? "Add a comment..." : "Add a reply..."}
            required
          />
        </div>
        
        {replyTo !== 0 && (
          <div className="mb-2 flex justify-between items-center">
            <span className="text-sm text-gray-500">
              Replying to comment #{replyTo}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(0)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel reply
            </button>
          </div>
        )}
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
        
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isLoading || !newComment.trim()}
            className={`py-2 px-4 rounded-md font-medium text-white ${
              isLoading || !newComment.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isLoading ? 'Submitting...' : 'Submit Comment'}
          </button>
        </div>
      </form>
      
      {/* Loading state */}
      {isLoading && comments.length === 0 && (
        <div className="text-center py-4">Loading comments...</div>
      )}
      
      {/* Comments list */}
      <div className="space-y-4">
        {rootComments.map(comment => renderComment(comment))}
      </div>
      
      {/* Empty state */}
      {!isLoading && comments.length === 0 && (
        <div className="text-center py-4 text-gray-500">
          No comments yet. Be the first to comment!
        </div>
      )}
    </div>
  );
};

export default CommentSection;
