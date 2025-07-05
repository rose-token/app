import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { GripVertical, User } from 'lucide-react';

const SortableCandidate = ({ candidate }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: candidate.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getRankColor = (rank) => {
    switch (rank) {
      case 1: return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 2: return 'bg-gray-100 border-gray-300 text-gray-800';
      case 3: return 'bg-orange-100 border-orange-300 text-orange-800';
      default: return 'bg-blue-100 border-blue-300 text-blue-800';
    }
  };

  const formatAddress = (address) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`cursor-grab active:cursor-grabbing transition-all duration-200 ${
        isDragging ? 'shadow-lg scale-105' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-center p-4 space-x-4">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <GripVertical size={20} />
        </div>

        <Badge 
          className={`min-w-[2rem] h-8 flex items-center justify-center font-bold ${getRankColor(candidate.rank)}`}
        >
          #{candidate.rank}
        </Badge>

        <div className="flex items-center space-x-3 flex-1">
          <div className="flex items-center justify-center w-10 h-10 bg-rose-100 rounded-full">
            <User size={20} className="text-rose-600" />
          </div>
          
          <div className="flex-1">
            <p className="font-medium text-gray-900">
              Candidate {formatAddress(candidate.address)}
            </p>
            <p className="text-sm text-gray-500 font-mono">
              {candidate.address}
            </p>
          </div>
        </div>

        {candidate.voteCount > 0 && (
          <Badge variant="outline" className="text-xs">
            {candidate.voteCount.toString()} votes
          </Badge>
        )}
      </div>
    </Card>
  );
};

export default SortableCandidate;
