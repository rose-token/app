import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import SortableCandidate from './SortableCandidate';

const RankedChoiceVoting = ({ candidates, onVoteSubmit, isLoading }) => {
  const [rankedCandidates, setRankedCandidates] = useState(
    candidates.map((candidate, index) => ({
      ...candidate,
      id: candidate.address,
      rank: index + 1
    }))
  );
  const [hasChanges, setHasChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      setRankedCandidates((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        const updatedItems = newItems.map((item, index) => ({
          ...item,
          rank: index + 1
        }));
        
        setHasChanges(true);
        return updatedItems;
      });
    }
  };

  const handleSubmitVote = async () => {
    const rankedChoices = rankedCandidates.map(candidate => candidate.address);
    await onVoteSubmit(rankedChoices);
    setHasChanges(false);
  };

  const resetRanking = () => {
    setRankedCandidates(
      candidates.map((candidate, index) => ({
        ...candidate,
        id: candidate.address,
        rank: index + 1
      }))
    );
    setHasChanges(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Rank Your Preferences</span>
          <Badge variant="outline">Drag to Reorder</Badge>
        </CardTitle>
        <p className="text-sm text-gray-600">
          Drag candidates to rank them in order of preference. Your #1 choice should be at the top.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={rankedCandidates.map(c => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {rankedCandidates.map((candidate) => (
                  <SortableCandidate
                    key={candidate.id}
                    candidate={candidate}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              variant="outline"
              onClick={resetRanking}
              disabled={!hasChanges || isLoading}
            >
              Reset
            </Button>
            <Button
              onClick={handleSubmitVote}
              disabled={!hasChanges || isLoading}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Submitting...
                </div>
              ) : (
                'Submit Vote'
              )}
            </Button>
          </div>

          <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded">
            <strong>How Ranked Choice Voting Works:</strong>
            <ul className="mt-1 space-y-1">
              <li>• Rank candidates in order of preference (#1 = most preferred)</li>
              <li>• If no candidate gets majority, lowest candidate is eliminated</li>
              <li>• Votes for eliminated candidates transfer to next preference</li>
              <li>• Process repeats until someone has majority</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RankedChoiceVoting;
