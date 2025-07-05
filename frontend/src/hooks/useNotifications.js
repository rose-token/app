import { useState, useEffect, useCallback } from 'react';

export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [notificationHistory, setNotificationHistory] = useState([]);

  const addNotification = useCallback((notification) => {
    const newNotification = {
      id: notification.id || `notification-${Date.now()}-${Math.random()}`,
      type: notification.type || 'info',
      title: notification.title,
      message: notification.message,
      action: notification.action,
      actionHandler: notification.actionHandler,
      timestamp: new Date(),
      read: false,
      persistent: notification.persistent || false,
      autoHide: notification.autoHide !== false,
      hideAfter: notification.hideAfter || 5000
    };

    setNotifications(prev => {
      const existing = prev.find(n => n.id === newNotification.id);
      if (existing) {
        return prev.map(n => n.id === newNotification.id ? { ...newNotification, read: existing.read } : n);
      }
      return [newNotification, ...prev];
    });

    setNotificationHistory(prev => {
      const existing = prev.find(n => n.id === newNotification.id);
      if (existing) {
        return prev.map(n => n.id === newNotification.id ? newNotification : n);
      }
      return [newNotification, ...prev.slice(0, 49)]; // Keep last 50 notifications
    });

    if (newNotification.autoHide && !newNotification.persistent) {
      setTimeout(() => {
        removeNotification(newNotification.id);
      }, newNotification.hideAfter);
    }
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const markAsRead = useCallback((id) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
    setNotificationHistory(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setNotificationHistory(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const getUnreadCount = useCallback(() => {
    return notifications.filter(n => !n.read).length;
  }, [notifications]);

  const addVotingDeadlineNotification = useCallback((electionId, timeRemaining) => {
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    let message, urgency;
    if (days > 1) {
      message = `Stakeholder election ${electionId} ends in ${days} days`;
      urgency = 'info';
    } else if (hours > 6) {
      message = `Stakeholder election ${electionId} ends in ${hours} hours`;
      urgency = 'warning';
    } else {
      message = `Stakeholder election ${electionId} ends in ${hours} hours - Vote now!`;
      urgency = 'error';
    }

    addNotification({
      id: `election-deadline-${electionId}`,
      type: urgency,
      title: 'Voting Deadline Approaching',
      message,
      action: 'Vote Now',
      persistent: hours <= 6,
      autoHide: hours > 6
    });
  }, [addNotification]);

  const addApprovalNotification = useCallback((taskId, taskDescription, urgency = 'warning') => {
    addNotification({
      id: `approval-needed-${taskId}`,
      type: urgency,
      title: 'Task Approval Required',
      message: `Task #${taskId}: ${taskDescription} requires your approval`,
      action: 'Review Task',
      persistent: urgency === 'error',
      autoHide: urgency !== 'error'
    });
  }, [addNotification]);

  const addReputationNotification = useCallback((newLevel, experience) => {
    addNotification({
      id: `reputation-level-${newLevel}`,
      type: 'success',
      title: 'Level Up!',
      message: `Congratulations! You've reached Stakeholder Level ${newLevel} with ${experience} XP`,
      action: 'View Dashboard',
      persistent: false,
      autoHide: true,
      hideAfter: 8000
    });
  }, [addNotification]);

  const addTaskCompletionNotification = useCallback((taskId, earnings) => {
    addNotification({
      id: `task-completed-${taskId}`,
      type: 'success',
      title: 'Task Completed',
      message: `Task #${taskId} has been completed. You earned ${earnings} ROSE tokens`,
      action: 'View Earnings',
      persistent: false,
      autoHide: true,
      hideAfter: 6000
    });
  }, [addNotification]);

  return {
    notifications,
    notificationHistory,
    addNotification,
    removeNotification,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    getUnreadCount,
    addVotingDeadlineNotification,
    addApprovalNotification,
    addReputationNotification,
    addTaskCompletionNotification
  };
};

export default useNotifications;
