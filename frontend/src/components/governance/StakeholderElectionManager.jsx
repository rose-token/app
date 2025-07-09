import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useContract } from '../../hooks/useContract';
import { useEthereum } from '../../hooks/useEthereum';
import RankedChoiceVoting from './RankedChoiceVoting';
import VotingProgressChart from './VotingProgressChart';

const StakeholderElectionManager = () => {
  const { tokenStaking, isLoading: contractsLoading } = useContract();
  const { account, isConnected } = useEthereum();
  const [activeElection, setActiveElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [userVote, setUserVote] = useState(null);
  const [electionResults, setElectionResults] = useState(null);

  const fetchElections = useCallback(async () => {
    if (!tokenStaking || !isConnected) return;

    try {
      setIsLoading(true);
      setError(null);

      const currentElectionId = await tokenStaking.electionCounter();
      if (currentElectionId.gt(0)) {
        const election = await tokenStaking.elections(currentElectionId);
        const candidateCount = await tokenStaking.getCandidateCount(currentElectionId);
        
        const candidateList = [];
        for (let i = 0; i < candidateCount; i++) {
          const candidate = await tokenStaking.getCandidate(currentElectionId, i);
          candidateList.push({
            address: candidate.candidate,
            voteCount: candidate.voteCount,
            eliminated: candidate.eliminated
          });
        }

        const electionData = {
          id: currentElectionId,
          startTime: election.startTime,
          endTime: election.endTime,
          isActive: election.isActive,
          finalized: election.finalized,
          candidates: candidateList
        };

        setActiveElection(electionData);
        setCandidates(candidateList);

        if (account) {
          try {
            const vote = await tokenStaking.getVote(currentElectionId, account);
            setUserVote(vote);
          } catch (err) {
            console.log('No vote found for user');
            setUserVote(null);
          }
        }

        if (election.finalized) {
          const results = await tokenStaking.getElectionResults(currentElectionId);
          setElectionResults(results);
        }
      }
    } catch (err) {
      console.error('Error fetching elections:', err);
      setError('Failed to fetch election data');
    } finally {
      setIsLoading(false);
    }
  }, [tokenStaking, isConnected, account]);


  const castVote = async (rankedChoices) => {
    if (!tokenStaking || !isConnected || !activeElection) return;

    try {
      setIsLoading(true);
      setError(null);

      const tx = await tokenStaking.castRankedChoiceVote(activeElection.id, rankedChoices);
      await tx.wait();

      await fetchElections();
    } catch (err) {
      console.error('Error casting vote:', err);
      setError('Failed to cast vote: ' + (err.reason || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  const finalizeElection = async () => {
    if (!tokenStaking || !isConnected || !activeElection) return;

    try {
      setIsLoading(true);
      setError(null);

      const tx = await tokenStaking.finalizeElection(activeElection.id);
      await tx.wait();

      await fetchElections();
    } catch (err) {
      console.error('Error finalizing election:', err);
      setError('Failed to finalize election: ' + (err.reason || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchElections();
  }, [fetchElections]);

  const isElectionActive = activeElection && activeElection.isActive && !activeElection.finalized;
  const canVote = isElectionActive && isConnected && !userVote;
  const timeRemaining = activeElection ? Math.max(0, activeElection.endTime * 1000 - Date.now()) : 0;

  if (contractsLoading || isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-600"></div>
            <span className="ml-2">Loading election data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Stakeholder Elections</span>
            {activeElection && (
              <Badge variant={isElectionActive ? "default" : "secondary"}>
                {isElectionActive ? "Active" : activeElection.finalized ? "Finalized" : "Ended"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {!activeElection ? (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">No active stakeholder election</p>
              <Button 
                onClick={() => {/* TODO: Implement candidate selection UI */}}
                disabled={!isConnected}
              >
                Start New Election
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Candidates</p>
                  <p className="text-2xl font-bold text-rose-600">{candidates.length}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Time Remaining</p>
                  <p className="text-2xl font-bold text-rose-600">
                    {timeRemaining > 0 ? Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)) + 'd' : 'Ended'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-600">Your Vote</p>
                  <p className="text-2xl font-bold text-rose-600">
                    {userVote ? 'Cast' : 'Not Cast'}
                  </p>
                </div>
              </div>

              {isElectionActive && (
                <VotingProgressChart 
                  candidates={candidates}
                  timeRemaining={timeRemaining}
                />
              )}

              {canVote && (
                <RankedChoiceVoting
                  candidates={candidates}
                  onVoteSubmit={castVote}
                  isLoading={isLoading}
                />
              )}

              {userVote && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Your Vote</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {userVote.preferences.map((candidateAddr, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span className="font-medium">#{index + 1}</span>
                          <span className="font-mono text-sm">{candidateAddr}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {isElectionActive && isConnected && (
                <div className="flex justify-end">
                  <Button 
                    onClick={finalizeElection}
                    variant="outline"
                    disabled={timeRemaining > 0}
                  >
                    Finalize Election
                  </Button>
                </div>
              )}

              {electionResults && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Election Results</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded border border-green-200">
                        <span className="font-medium">Winner:</span>
                        <span className="font-mono text-sm">{electionResults.winner}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Total Rounds: {electionResults.totalRounds}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StakeholderElectionManager;
