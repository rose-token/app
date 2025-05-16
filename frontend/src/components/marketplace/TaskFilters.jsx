import React from 'react';

const TaskFilters = ({ filters, setFilters }) => {
  const handleFilterChange = (filterName) => {
    setFilters(prev => ({
      ...prev,
      [filterName]: !prev[filterName]
    }));
  };

  const resetFilters = () => {
    setFilters({
      needStakeholder: true,
      needWorker: true,
      myTasks: true,
      showClosed: false
    });
  };

  const usingCustomFilters = 
    !filters.needStakeholder || 
    !filters.needWorker || 
    !filters.myTasks || 
    filters.showClosed;

  return (
    <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-md font-medium">Filter Tasks</h3>
        {usingCustomFilters && (
          <button 
            onClick={resetFilters}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Reset to defaults
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input 
            type="checkbox" 
            checked={filters.needStakeholder} 
            onChange={() => handleFilterChange('needStakeholder')}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">Need Stakeholder</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input 
            type="checkbox" 
            checked={filters.needWorker} 
            onChange={() => handleFilterChange('needWorker')}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">Need Worker</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input 
            type="checkbox" 
            checked={filters.myTasks} 
            onChange={() => handleFilterChange('myTasks')}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">My Tasks</span>
        </label>
        
        <label className="flex items-center space-x-2 cursor-pointer">
          <input 
            type="checkbox" 
            checked={filters.showClosed} 
            onChange={() => handleFilterChange('showClosed')}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">Show Closed</span>
        </label>
      </div>
    </div>
  );
};

export default TaskFilters;
