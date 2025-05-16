import React from 'react';
import BugSubmissionForm from '../components/bugs/BugSubmissionForm';
import BugReportList from '../components/bugs/BugReportList';
import BugReportLookup from '../components/bugs/BugReportLookup';

const BugsPage = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Bug Reports</h1>
      
      <div className="grid grid-cols-1 gap-8">
        <BugSubmissionForm />
        <BugReportList />
        <BugReportLookup />
      </div>
    </div>
  );
};

export default BugsPage;
