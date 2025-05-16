import React, { useState, useEffect, useCallback } from 'react';
import { fetchCommentFromIPFS } from '../../utils/ipfs/pinataService';

const BugReportList = () => {
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedBugs = JSON.parse(localStorage.getItem('submittedBugs') || '[]');
    setReports(storedBugs);
  }, []);

  const fetchReportDetails = useCallback(async (cid) => {
    if (!cid) return;
    
    try {
      setLoading(true);
      setError('');
      
      const reportData = await fetchCommentFromIPFS(cid);
      const parsedData = typeof reportData === 'string' 
        ? JSON.parse(reportData) 
        : reportData;
      
      setSelectedReport({
        cid,
        ...parsedData
      });
    } catch (err) {
      console.error('Error fetching report details:', err);
      setError('Failed to fetch report details from IPFS');
    } finally {
      setLoading(false);
    }
  }, []);

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
      <h2 className="text-xl font-semibold mb-4">Submitted Bug Reports</h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* List of reports */}
        <div className="md:col-span-1 border-r pr-4">
          {reports.length === 0 ? (
            <p className="text-gray-500">No bug reports submitted yet.</p>
          ) : (
            <ul className="space-y-2">
              {reports.map((report) => (
                <li 
                  key={report.cid}
                  className={`p-3 rounded-md cursor-pointer hover:bg-gray-50 ${
                    selectedReport?.cid === report.cid ? 'bg-blue-50 border border-blue-200' : 'border border-gray-200'
                  }`}
                  onClick={() => fetchReportDetails(report.cid)}
                >
                  <h3 className="font-medium text-gray-900 truncate">{report.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDate(report.timestamp)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    CID: {report.cid}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {/* Report details */}
        <div className="md:col-span-2 pl-4">
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <p>Loading report details...</p>
            </div>
          ) : selectedReport ? (
            <div>
              <h3 className="text-lg font-semibold">{selectedReport.title}</h3>
              <p className="text-sm text-gray-500 mb-4">
                Submitted on {formatDate(selectedReport.timestamp)}
              </p>
              
              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
                <div className="p-3 bg-gray-50 rounded-md">
                  <p className="whitespace-pre-wrap">{selectedReport.description}</p>
                </div>
              </div>
              
              {selectedReport.steps && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Steps to Reproduce</h4>
                  <div className="p-3 bg-gray-50 rounded-md">
                    <p className="whitespace-pre-wrap">{selectedReport.steps}</p>
                  </div>
                </div>
              )}
              
              <div className="mt-4 text-xs text-gray-500">
                <p>IPFS Content Identifier (CID): {selectedReport.cid}</p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center items-center h-40 text-gray-500">
              <p>Select a report to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BugReportList;
