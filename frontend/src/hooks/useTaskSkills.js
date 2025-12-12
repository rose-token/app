/**
 * useTaskSkills Hook
 *
 * Fetches IPFS content for tasks to extract skills data,
 * provides skill matching logic, and caches results.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchTaskDescription } from '../utils/ipfs/pinataService';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CONCURRENT_LIMIT = 10; // Max parallel IPFS fetches

/**
 * @param {Array} tasks - Array of task objects with detailedDescription (IPFS hash)
 * @returns {Object} Skills data and matching utilities
 */
export const useTaskSkills = (tasks = []) => {
  const [skillsCache, setSkillsCache] = useState(() => new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Track in-flight fetches to prevent race conditions
  const inFlightRef = useRef(new Set());
  // Track which hashes have been fetched to avoid redundant requests
  const fetchedHashesRef = useRef(new Set());
  // Store last tasks ref to compare
  const lastTasksRef = useRef([]);

  // Fetch task skills from IPFS
  const fetchTaskSkills = useCallback(async (task) => {
    const hash = task.detailedDescription;

    if (!hash) {
      return { taskId: task.id, skills: [], loaded: true };
    }

    // Skip if already in flight
    if (inFlightRef.current.has(hash)) {
      return null;
    }

    try {
      inFlightRef.current.add(hash);
      const content = await fetchTaskDescription(hash);
      return { taskId: task.id, skills: content.skills || [], loaded: true };
    } catch (error) {
      console.error(`Failed to fetch skills for task ${task.id}:`, error);
      return { taskId: task.id, skills: [], loaded: true, error: true };
    } finally {
      inFlightRef.current.delete(hash);
      fetchedHashesRef.current.add(hash);
    }
  }, []);

  // Enrich tasks with skills data
  useEffect(() => {
    if (tasks.length === 0) return;

    // Check if tasks array actually changed
    const taskIds = tasks.map(t => t.id).join(',');
    const lastTaskIds = lastTasksRef.current.map(t => t.id).join(',');
    if (taskIds === lastTaskIds) return;
    lastTasksRef.current = tasks;

    // Find tasks that need fetching
    const tasksToFetch = tasks.filter(task => {
      if (!task.detailedDescription) return false;
      // Skip if already fetched this session
      if (fetchedHashesRef.current.has(task.detailedDescription)) return false;
      // Skip if already in flight
      if (inFlightRef.current.has(task.detailedDescription)) return false;
      return true;
    });

    if (tasksToFetch.length === 0) return;

    const enrichTasks = async () => {
      setIsLoading(true);

      // Batch fetch in chunks
      const results = [];
      for (let i = 0; i < tasksToFetch.length; i += CONCURRENT_LIMIT) {
        const chunk = tasksToFetch.slice(i, i + CONCURRENT_LIMIT);
        const chunkResults = await Promise.allSettled(
          chunk.map(task => fetchTaskSkills(task))
        );

        chunkResults.forEach((result) => {
          if (result.status === 'fulfilled' && result.value) {
            results.push(result.value);
          }
        });
      }

      if (results.length > 0) {
        setSkillsCache(prev => {
          const newCache = new Map(prev);
          results.forEach(({ taskId, skills }) => {
            newCache.set(taskId, { skills, timestamp: Date.now() });
          });
          return newCache;
        });
      }

      setIsLoading(false);
    };

    enrichTasks();
  }, [tasks, fetchTaskSkills]);

  // Clear refs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      inFlightRef.current.clear();
      fetchedHashesRef.current.clear();
    };
  }, []);

  // Merge tasks with cached skills
  const enrichedTasks = useMemo(() => {
    return tasks.map(task => ({
      ...task,
      skills: skillsCache.get(task.id)?.skills || []
    }));
  }, [tasks, skillsCache]);

  // Check if task has matching skills with user - stable callback
  const hasSkillMatch = useCallback((taskId, userSkills) => {
    if (!userSkills || userSkills.length === 0) return false;

    const cached = skillsCache.get(taskId);
    if (!cached) return false; // Not loaded yet

    const taskSkills = cached.skills || [];
    if (taskSkills.length === 0) return false;

    return taskSkills.some(skill => userSkills.includes(skill));
  }, [skillsCache]);

  // Get skills for a specific task
  const getTaskSkills = useCallback((taskId) => {
    return skillsCache.get(taskId)?.skills || [];
  }, [skillsCache]);

  return {
    enrichedTasks,
    isLoading,
    hasSkillMatch,
    getTaskSkills
  };
};

export default useTaskSkills;
