import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Clock, Users, TrendingUp } from 'lucide-react';

const VotingProgressChart = ({ candidates, timeRemaining }) => {
  const chartData = useMemo(() => {
    return candidates
      .filter(candidate => !candidate.eliminated)
      .map((candidate, index) => ({
        name: `Candidate ${index + 1}`,
        address: candidate.address,
        votes: parseInt(candidate.voteCount.toString()),
        shortAddress: `${candidate.address.slice(0, 6)}...${candidate.address.slice(-4)}`
      }))
      .sort((a, b) => b.votes - a.votes);
  }, [candidates]);

  const totalVotes = useMemo(() => {
    return chartData.reduce((sum, candidate) => sum + candidate.votes, 0);
  }, [chartData]);

  const pieData = useMemo(() => {
    return chartData.map((candidate, index) => ({
      ...candidate,
      percentage: totalVotes > 0 ? ((candidate.votes / totalVotes) * 100).toFixed(1) : 0
    }));
  }, [chartData, totalVotes]);

  const colors = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

  const formatTimeRemaining = (milliseconds) => {
    if (milliseconds <= 0) return 'Voting Ended';
    
    const days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
    const hours = Math.floor((milliseconds % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const leadingCandidate = chartData.length > 0 ? chartData[0] : null;
  const votingProgress = totalVotes > 0 ? Math.min(100, (totalVotes / (candidates.length * 10)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-rose-100 rounded-lg">
                <Clock className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Time Remaining</p>
                <p className="text-lg font-semibold">{formatTimeRemaining(timeRemaining)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Votes</p>
                <p className="text-lg font-semibold">{totalVotes}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Leading</p>
                <p className="text-lg font-semibold">
                  {leadingCandidate ? leadingCandidate.shortAddress : 'No votes'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Vote Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="shortAddress" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  fontSize={12}
                />
                <YAxis />
                <Tooltip 
                  formatter={(value, name, props) => [
                    `${value} votes`,
                    `Candidate: ${props.payload.shortAddress}`
                  ]}
                  labelFormatter={(label) => `Address: ${label}`}
                />
                <Bar dataKey="votes" fill="#e11d48" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Vote Share</CardTitle>
          </CardHeader>
          <CardContent>
            {totalVotes > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="votes"
                    label={({ shortAddress, percentage }) => `${shortAddress}: ${percentage}%`}
                    labelLine={false}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value, name, props) => [
                      `${value} votes (${props.payload.percentage}%)`,
                      props.payload.shortAddress
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-500">
                <div className="text-center">
                  <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No votes cast yet</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Candidate Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {chartData.map((candidate, index) => (
              <div key={candidate.address} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-4">
                  <Badge 
                    className={`min-w-[2rem] h-8 flex items-center justify-center font-bold ${
                      index === 0 ? 'bg-yellow-100 border-yellow-300 text-yellow-800' :
                      index === 1 ? 'bg-gray-100 border-gray-300 text-gray-800' :
                      index === 2 ? 'bg-orange-100 border-orange-300 text-orange-800' :
                      'bg-blue-100 border-blue-300 text-blue-800'
                    }`}
                  >
                    #{index + 1}
                  </Badge>
                  <div>
                    <p className="font-medium">{candidate.shortAddress}</p>
                    <p className="text-xs text-gray-500 font-mono">{candidate.address}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{candidate.votes} votes</p>
                  {totalVotes > 0 && (
                    <p className="text-sm text-gray-500">
                      {((candidate.votes / totalVotes) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Voting Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Participation Rate</span>
              <span>{votingProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-rose-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${votingProgress}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500">
              Based on estimated eligible voters
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VotingProgressChart;
