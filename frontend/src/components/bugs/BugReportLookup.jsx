import React, { useState, useCallback } from 'react';
import { fetchCommentFromIPFS, isCID } from '../../utils/ipfs/pinataService';

const BugReportLookup = () => {
  const [cid, setCid] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const lookupReport = useCallback(async (e) => {
    e.preventDefault();
    if (!cid.trim()) return;
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      setReport(null);
      
      if (!isCID(cid)) {
        setError('Invalid CID format. Please enter a valid IPFS Content Identifier.');
        return;
      }
      
      const reportData = await fetchCommentFromIPFS(cid);
      
      const parsedData = typeof reportData === 'string' 
        ? JSON.parse(reportData) 
        : reportData;
      
      if (parsedData.type !== 'bug-report') {
        setError('The content at this CID is not a bug report.');
        return;
      }
      
      setReport({
        cid,
        ...parsedData
      });
      setSuccess('Bug report found!');
    } catch (err) {
      console.error('Error looking up report:', err);
      setError('Failed to fetch report. The CID may be invalid or the content is not available on IPFS.');
    } finally {
      setLoading(false);
    }
  }, [cid]);

  const formatDate = (dateString) => {
    const options = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
      <h2 className="text-xl font-semibold mb-4">Look Up Bug Report by CID</h2>
      
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
      
      <form onSubmit={lookupReport} className="mb-6">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            type="text"
            value={cid}
            onChange={(e) => setCid(e.target.value)}
            placeholder="Enter IPFS Content Identifier (CID)"
            className="flex-grow p-2 border border-gray-300 rounded-md"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-white py-2 px-4 rounded-md hover:bg-opacity-90 disabled:opacity-50"
          >
            {loading ? 'Looking up...' : 'Look Up Report'}
          </button>
        </div>
      </form>
      
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <p>Loading report details...</p>
        </div>
      ) : report ? (
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold">{report.title}</h3>
          <p className="text-sm text-gray-500 mb-4">
            Submitted on {formatDate(report.timestamp)}
          </p>
          
          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
            <div className="p-3 bg-gray-50 rounded-md">
              <p className="whitespace-pre-wrap">{report.description}</p>
            </div>
          </div>
          
          {report.steps && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-1">Steps to Reproduce</h4>
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="whitespace-pre-wrap">{report.steps}</p>
              </div>
            </div>
          )}
          
          <div className="mt-4 text-xs text-gray-500">
            <p>IPFS Content Identifier (CID): {report.cid}</p>
          </div>
        </div>
      ) : (
        <div className="flex justify-center items-center h-40 text-gray-500 border border-dashed border-gray-300 rounded-lg">
          <p>Enter a CID to look up a bug report</p>
        </div>
      )}
    </div>
  );
};

export default BugReportLookup;
