import React, { useState } from 'react';
import { uploadCommentToIPFS } from '../../utils/ipfs/pinataService';

const BugSubmissionForm = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submittedCid, setSubmittedCid] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');
      
      const bugData = JSON.stringify({
        title,
        description,
        steps,
        timestamp: new Date().toISOString(),
        type: 'bug-report' // Add a type field to distinguish from comments
      });
      
      const cid = await uploadCommentToIPFS(bugData);
      
      const storedBugs = JSON.parse(localStorage.getItem('submittedBugs') || '[]');
      storedBugs.push({
        cid,
        title,
        timestamp: new Date().toISOString()
      });
      localStorage.setItem('submittedBugs', JSON.stringify(storedBugs));
      
      setTitle('');
      setDescription('');
      setSteps('');
      setSubmittedCid(cid);
      setSuccess(`Bug report submitted successfully! CID: ${cid}`);
    } catch (err) {
      console.error('Error submitting bug report:', err);
      if (err.message.includes('Pinata')) {
        setError('Failed to upload bug report to IPFS. Please check Pinata API keys.');
      } else {
        setError('Failed to submit bug report');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Submit Bug Report</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}
      
      {success && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-md">
          {success}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md h-24"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Steps to Reproduce
          </label>
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md h-24"
          />
        </div>
        
        <button
          type="submit"
          disabled={isLoading}
          className="bg-primary text-white py-2 px-4 rounded-md hover:bg-opacity-90 disabled:opacity-50"
        >
          {isLoading ? 'Submitting...' : 'Submit Bug Report'}
        </button>
      </form>
      
      {submittedCid && (
        <div className="mt-4 p-3 bg-blue-50 text-blue-700 rounded-md">
          <p>Your bug report has been stored on IPFS.</p>
          <p className="text-sm mt-1">
            <strong>CID:</strong> {submittedCid}
          </p>
          <p className="text-xs mt-2">
            Save this CID to reference your bug report later.
          </p>
        </div>
      )}
    </div>
  );
};

export default BugSubmissionForm;
