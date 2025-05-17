import React, { useState, useEffect, useCallback } from 'react';
import { uploadCommentToIPFS, uploadEncryptedCommentToIPFS, fetchCommentFromIPFS, isCID } from '../../utils/ipfs/pinataService';
import { decryptContent } from '../../utils/encryption/pgpService';
import KeyManagement from './KeyManagement';

const CommentSection = ({ taskId, roseMarketplace, task, isAuthorized = false }) => {
  const [comments, setComments] = useState([]);
  const [commentContents, setCommentContents] = useState({}); // Map of CIDs to content
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchErrors, setFetchErrors] = useState({}); // Track IPFS fetch errors
  const [privateKey, setPrivateKey] = useState(localStorage.getItem('userPrivateKey'));
  const [allKeysSetup, setAllKeysSetup] = useState(false);
  
  const checkParticipantKeys = useCallback(async () => {
    if (!roseMarketplace || !task) return false;
    
    try {
      const customerPublicKey = await roseMarketplace.userPublicKeys(task.customer);
      const workerPublicKey = await roseMarketplace.userPublicKeys(task.worker);
      const stakeholderPublicKey = await roseMarketplace.userPublicKeys(task.stakeholder);
      
      return !!customerPublicKey && !!workerPublicKey && !!stakeholderPublicKey;
    } catch (err) {
      console.error('Error checking participant keys:', err);
      return false;
    }
  }, [roseMarketplace, task]);
  
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString();
  };
  
  const fetchComments = useCallback(async () => {
    if (!roseMarketplace || !taskId) return;
    
    try {
      setIsLoading(true);
      const comments = await roseMarketplace.getTaskComments(taskId);
      setComments(comments);
      
      const contentPromises = comments.map(async (comment, index) => {
        const cid = comment.ipfsCid || comment.content; // Support both new CID field and legacy content field
        
        if (!cid) return;
        
        if (isCID(cid)) {
          try {
            const data = await fetchCommentFromIPFS(cid);
            
            if (data.isEncrypted && privateKey) {
              try {
                const decryptedContent = await decryptContent(
                  data.encryptedContent,
                  privateKey
                );
                return { index, cid, content: decryptedContent };
              } catch (decryptErr) {
                console.error(`Error decrypting comment ${index}:`, decryptErr);
                return { 
                  index, 
                  cid, 
                  content: 'Unable to decrypt comment. You may not have permission to view it.' 
                };
              }
            } else {
              return { index, cid, content: data.content || data };
            }
          } catch (err) {
            console.error(`Error fetching comment ${index} from IPFS:`, err);
            setFetchErrors(prev => ({ ...prev, [index]: true }));
            return { index, cid, content: 'Content could not be loaded from IPFS' };
          }
        } else {
          return { index, cid, content: cid }; // For legacy comments, cid actually contains the content
        }
      });
      
      const contents = await Promise.allSettled(contentPromises);
      
      const contentMap = {};
      contents.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          contentMap[result.value.index + 1] = result.value.content;
        }
      });
      
      setCommentContents(contentMap);
    } catch (err) {
      console.error('Error fetching comments:', err);
      setError('Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  }, [roseMarketplace, taskId, privateKey, setIsLoading, setComments, setError, setFetchErrors, setCommentContents]);
  
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !roseMarketplace) return;
    
    try {
      setIsLoading(true);
      setError('');
      
      let cid;
      
      if (allKeysSetup && privateKey) {
        const customerPublicKey = await roseMarketplace.userPublicKeys(task.customer);
        const workerPublicKey = await roseMarketplace.userPublicKeys(task.worker);
        const stakeholderPublicKey = await roseMarketplace.userPublicKeys(task.stakeholder);
        
        cid = await uploadEncryptedCommentToIPFS(newComment, [
          customerPublicKey,   
          workerPublicKey,   
          stakeholderPublicKey  
        ]);
      } else {
        cid = await uploadCommentToIPFS(newComment);
      }
      
      const tx = await roseMarketplace.addComment(taskId, cid, replyTo);
      await tx.wait();
      
      setNewComment('');
      if (replyTo !== 0) setReplyTo(0);
      
      await fetchComments();
    } catch (err) {
      console.error('Error adding comment:', err);
      if (err.message.includes('Pinata')) {
        setError('Failed to upload comment to IPFS. Please check Pinata API keys.');
      } else if (err.message.includes('PGP keys')) {
        setError('Not all participants have set up their PGP keys. Please make sure all participants have generated keys.');
      } else {
        setError('Failed to add comment: ' + err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  // Listen for changes to localStorage privateKey
  useEffect(() => {
    const handleStorageChange = () => {
      const storedPrivateKey = localStorage.getItem('userPrivateKey');
      if (storedPrivateKey !== privateKey) {
        setPrivateKey(storedPrivateKey);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [privateKey]);
  
  useEffect(() => {
    if (roseMarketplace && task) {
      checkParticipantKeys().then(result => {
        setAllKeysSetup(result);
      });
    }
  }, [roseMarketplace, task, checkParticipantKeys]);

  useEffect(() => {
    if (roseMarketplace && taskId) {
      fetchComments();
      
      const commentFilter = roseMarketplace.filters.CommentAdded();
      const commentListener = (eventTaskId, commentId, author, parentCommentId) => {
        if (eventTaskId.toNumber() === Number(taskId)) {
          console.log('Comment added:', { taskId: eventTaskId.toNumber(), commentId, author, parentCommentId });
          fetchComments();
        }
      };
      
      roseMarketplace.on(commentFilter, commentListener);
      
      return () => {
        roseMarketplace.off(commentFilter, commentListener);
      };
    }
  }, [roseMarketplace, taskId, fetchComments]);
  
  const threadsMap = {};
  const rootComments = [];
  const mutableComments = [];
  
  comments.forEach((comment, index) => {
    const mutableComment = { ...comment };
    mutableComment.id = index + 1; // 1-based ID
    mutableComment.replies = [];
    mutableComments.push(mutableComment);
    
    if (mutableComment.parentCommentId.toNumber() === 0) {
      rootComments.push(mutableComment);
    } else {
      if (!threadsMap[mutableComment.parentCommentId.toNumber()]) {
        threadsMap[mutableComment.parentCommentId.toNumber()] = [];
      }
      threadsMap[mutableComment.parentCommentId.toNumber()].push(mutableComment);
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
            {commentContents[comment.id] || fetchErrors[comment.id] ? 
              (fetchErrors[comment.id] ? 
                <div className="text-red-500">
                  Content could not be loaded from IPFS. 
                  <button 
                    onClick={() => fetchCommentFromIPFS(comment.ipfsCid || comment.content)
                      .then(content => {
                        setCommentContents(prev => ({ ...prev, [comment.id]: content }));
                        setFetchErrors(prev => ({ ...prev, [comment.id]: false }));
                      })
                      .catch(() => {/* Already handled */})
                    } 
                    className="ml-2 text-blue-500 underline"
                  >
                    Retry
                  </button>
                </div> : 
                commentContents[comment.id]
              ) : 
              'Loading content...'
            }
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

  if (isAuthorized && !privateKey) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4">Comments</h3>
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">
          <p className="font-medium">PGP Key Setup Required</p>
          <p className="text-sm mt-1">
            To view and send encrypted comments, you need to set up your PGP keys first.
          </p>
        </div>
        <KeyManagement account={task.customer} roseMarketplace={roseMarketplace} />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-4">Comments</h3>
      
      {/* Key Management Component */}
      <KeyManagement account={task.customer} roseMarketplace={roseMarketplace} />
      
      {/* Warning when not all participants have keys */}
      {!allKeysSetup && (
        <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-md">
          <p className="font-medium">Not all participants have set up their PGP keys.</p>
          <p className="text-sm mt-1">
            Comments will be stored unencrypted until all participants (customer, worker, and stakeholder) have generated their PGP keys.
          </p>
        </div>
      )}
      
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
