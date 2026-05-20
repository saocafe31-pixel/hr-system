type LeaveStatusChangedPayload = {
  leaveId: string;
  action: 'approved' | 'rejected';
  source: 'team' | 'chat' | 'other';
};

type LeaveStatusChangedListener = (payload: LeaveStatusChangedPayload) => void;
type TaskStatusChangedPayload = {
  taskId: string;
  status: string;
  source: 'tasks' | 'task_detail' | 'team' | 'other';
};
type TaskStatusChangedListener = (payload: TaskStatusChangedPayload) => void;
type MentionReadPayload = {
  mentionIds?: string[];
  source: 'notif_center' | 'chat' | 'other';
};
type MentionReadListener = (payload: MentionReadPayload) => void;

const leaveStatusChangedListeners = new Set<LeaveStatusChangedListener>();
const taskStatusChangedListeners = new Set<TaskStatusChangedListener>();
const mentionReadListeners = new Set<MentionReadListener>();

export function emitLeaveStatusChanged(payload: LeaveStatusChangedPayload) {
  for (const fn of leaveStatusChangedListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onLeaveStatusChanged(listener: LeaveStatusChangedListener) {
  leaveStatusChangedListeners.add(listener);
  return () => {
    leaveStatusChangedListeners.delete(listener);
  };
}

export function emitTaskStatusChanged(payload: TaskStatusChangedPayload) {
  for (const fn of taskStatusChangedListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onTaskStatusChanged(listener: TaskStatusChangedListener) {
  taskStatusChangedListeners.add(listener);
  return () => {
    taskStatusChangedListeners.delete(listener);
  };
}

export function emitMentionRead(payload: MentionReadPayload) {
  for (const fn of mentionReadListeners) {
    try {
      fn(payload);
    } catch {
      // ignore listener errors to avoid breaking emitter callsite
    }
  }
}

export function onMentionRead(listener: MentionReadListener) {
  mentionReadListeners.add(listener);
  return () => {
    mentionReadListeners.delete(listener);
  };
}
