import React from 'react';
import { useWorkerAnalytics } from '../hooks/useWorkerAnalytics';
import { useEthereum } from '../hooks/useEthereum';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Alert, AlertDescription } from '../components/ui/alert';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';

const AnalyticsPage = () => {
  const { isConnected } = useEthereum();
  const { analytics, isLoading, error, refreshAnalytics } = useWorkerAnalytics();

  const formatMonth = (monthYear) => {
    if (!monthYear) return '';
    const [year, month] = monthYear.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleString('default', { month: 'short', year: '2-digit' });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Worker Analytics</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent className="h-80">
              <Skeleton className="h-full w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent className="h-80">
              <Skeleton className="h-full w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Worker Analytics</h1>
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <h3 className="text-xl font-medium mb-2">Connect Your Wallet</h3>
              <p className="text-muted-foreground mb-4">
                Please connect your wallet to view your worker analytics
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Worker Analytics</h1>
        <Alert variant="destructive" className="mb-8">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={refreshAnalytics}>Retry</Button>
      </div>
    );
  }

  if (analytics.totalTasksClaimed === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Worker Analytics</h1>
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <h3 className="text-xl font-medium mb-2">No Worker Data</h3>
              <p className="text-muted-foreground mb-4">
                You haven't claimed or completed any tasks yet. Start working on tasks to see your analytics.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Worker Analytics</h1>
        <Button onClick={refreshAnalytics} variant="outline" size="sm">
          Refresh Data
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalEarnings} ETH</div>
            <p className="text-xs text-muted-foreground">
              From {analytics.totalTasksCompleted} completed tasks
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.successRate}%</div>
            <p className="text-xs text-muted-foreground">
              Tasks completed / tasks claimed
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasks Claimed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalTasksClaimed}</div>
            <p className="text-xs text-muted-foreground">
              Total tasks you've worked on
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Token Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.tokenBalance} ROSE</div>
            <p className="text-xs text-muted-foreground">
              Current ROSE token balance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Earnings Over Time Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Earnings Over Time</CardTitle>
            <CardDescription>
              Your earnings by month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              {analytics.earnings && analytics.earnings.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={analytics.earnings}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="month" 
                      tickFormatter={formatMonth}
                    />
                    <YAxis />
                    <Tooltip 
                      formatter={(value) => [`${value} ETH`, 'Earnings']}
                      labelFormatter={formatMonth}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="amount" 
                      stroke="#8884d8" 
                      activeDot={{ r: 8 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Not enough data to display chart</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Task Completion Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Task Completion</CardTitle>
            <CardDescription>
              Completed vs. in-progress tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: 'Completed', value: analytics.totalTasksCompleted },
                    { name: 'In Progress', value: analytics.totalTasksClaimed - analytics.totalTasksCompleted }
                  ]}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            Your most recent tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Task ID</th>
                  <th className="text-left py-3 px-4 font-medium">Description</th>
                  <th className="text-left py-3 px-4 font-medium">Deposit</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentActivity && analytics.recentActivity.length > 0 ? (
                  analytics.recentActivity.map((task) => (
                    <tr key={task.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{task.id}</td>
                      <td className="py-3 px-4">
                        {task.description.length > 30
                          ? `${task.description.substring(0, 30)}...`
                          : task.description}
                      </td>
                      <td className="py-3 px-4">{task.deposit} ETH</td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs ${
                          task.status === 'Completed' || task.status === 'Closed'
                            ? 'bg-green-100 text-green-800'
                            : task.status === 'Disputed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {task.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {new Date(task.timestamp).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-4 text-center text-muted-foreground">
                      No recent activity
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Completed Tasks */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Completed Tasks</CardTitle>
          <CardDescription>
            All tasks you've successfully completed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Task ID</th>
                  <th className="text-left py-3 px-4 font-medium">Description</th>
                  <th className="text-left py-3 px-4 font-medium">Earnings</th>
                  <th className="text-left py-3 px-4 font-medium">Customer</th>
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {analytics.completedTasks && analytics.completedTasks.length > 0 ? (
                  analytics.completedTasks.map((task) => (
                    <tr key={task.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{task.id}</td>
                      <td className="py-3 px-4">
                        {task.description.length > 30
                          ? `${task.description.substring(0, 30)}...`
                          : task.description}
                      </td>
                      <td className="py-3 px-4">{task.earnings} ETH</td>
                      <td className="py-3 px-4">
                        {`${task.customer.substring(0, 6)}...${task.customer.substring(38)}`}
                      </td>
                      <td className="py-3 px-4">
                        {new Date(task.timestamp).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-4 text-center text-muted-foreground">
                      No completed tasks
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AnalyticsPage;
